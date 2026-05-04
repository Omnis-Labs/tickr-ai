import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { MandateInputSchema } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { requireAuth, requireAuthOrUpsert } from '@/lib/auth/context';
import { verifyPrivyToken } from '@/lib/auth/privy';
import { isDemoServer } from '@/lib/demo/flag';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * GET    /api/mandates                                  Returns the authed user's mandate.
 * POST   /api/mandates  body: { walletAddress, ...MandateInput }   Creates first mandate.
 * PUT    /api/mandates  body: { walletAddress, ...MandateInput }   Updates mandate.
 *
 * Auth: Privy access token. walletAddress in the body is used only on POST/PUT
 * for first-touch user upsert (so a brand-new user can be created the moment
 * they finish mandate setup), and is reconciled against the verified Privy id.
 *
 * Demo mode: requireAuth(OrUpsert) returns the canonical demo user, so all
 * reads/writes flow through the same Prisma path as live. SessionGate's
 * demoState() reads the same row, so the funnel is consistent end-to-end.
 */

export async function GET(req: NextRequest) {
  // First-touch users have a valid Privy session but no `User` row yet — the
  // row is upserted lazily on POST below. `requireAuth` would 401 those users
  // (it returns null when the DB lookup misses), and `useAuthedFetch` treats
  // any /api/* 401 as a session-expiry event and bounces to /login. Combined
  // with /login's auto-replay to `next`, that produces a /mandate ↔ /login
  // redirect loop the user can never break out of.
  //
  // The correct semantics here mirror SessionGate.stateForPrivyUserId: a
  // Privy-authed but unprovisioned user is in the NEEDS_MANDATE stage, which
  // for this route means "no mandate yet" — a 200 with `mandate: null`, not
  // a 401. POST/PUT below still go through requireAuth(OrUpsert) so writes
  // remain authenticated end-to-end.
  if (isDemoServer()) {
    const auth = await requireAuth(req);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const mandate = await prisma.mandate.findUnique({ where: { userId: auth.userId } });
    return NextResponse.json({ mandate: decimalsToNumbers(mandate) });
  }

  const claims = await verifyPrivyToken(req);
  if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { privyUserId: claims.userId },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ mandate: null });

  const mandate = await prisma.mandate.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ mandate: decimalsToNumbers(mandate) });
}

const PostSchema = MandateInputSchema.extend({
  walletAddress: z.string().min(11),
});

async function upsertMandate(
  req: NextRequest,
  upsert: boolean,
): Promise<NextResponse> {
  const body: unknown = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { walletAddress, ...mandateInput } = parsed.data;

  const auth = upsert
    ? await requireAuthOrUpsert(req, walletAddress)
    : await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const mandate = await prisma.mandate.upsert({
    where: { userId: auth.userId },
    update: {
      holdingPeriod: mandateInput.holdingPeriod,
      maxDrawdown: mandateInput.maxDrawdown,
      maxTradeSize: mandateInput.maxTradeSize,
      marketFocus: mandateInput.marketFocus,
    },
    create: {
      userId: auth.userId,
      holdingPeriod: mandateInput.holdingPeriod,
      maxDrawdown: mandateInput.maxDrawdown,
      maxTradeSize: mandateInput.maxTradeSize,
      marketFocus: mandateInput.marketFocus,
    },
  });

  // PUT (mandate edit) — invalidate any stale ACTIVE proposals so the
  // Proposal Generator regenerates them against the new mandate. POST
  // (first-touch create) skips this since there can't be priors.
  if (!upsert) {
    await prisma.proposal.updateMany({
      where: { userId: auth.userId, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
  }

  return NextResponse.json({ mandate: decimalsToNumbers(mandate) });
}

export async function POST(req: NextRequest) {
  return upsertMandate(req, true); // first-touch may create the user row
}

export async function PUT(req: NextRequest) {
  return upsertMandate(req, false); // user must already exist
}
