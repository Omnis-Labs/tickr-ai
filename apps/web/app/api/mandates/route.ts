import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DEMO_MANDATE, MandateInputSchema } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth, requireAuthOrUpsert } from '@/lib/auth/context';
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
 * Demo mode: GET returns DEMO_MANDATE; POST/PUT echo back the submitted shape.
 */

export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ mandate: DEMO_MANDATE });
  }
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const mandate = await prisma.mandate.findUnique({ where: { userId: auth.userId } });
  return NextResponse.json({ mandate: decimalsToNumbers(mandate) });
}

const PostSchema = MandateInputSchema.extend({
  walletAddress: z.string().min(32),
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

  if (isDemoServer()) {
    return NextResponse.json({
      mandate: { ...DEMO_MANDATE, ...mandateInput, updatedAt: new Date().toISOString() },
    });
  }

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
