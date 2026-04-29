import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth, requireAuthOrUpsert } from '@/lib/auth/context';

/**
 * Phase F — delegated signing toggle persistence.
 *
 *   GET   /api/users/delegation
 *           returns { delegationActive, privyWalletId } from the DB so the
 *           Settings toggle can hydrate from server state on mount instead
 *           of localStorage. Demo mode short-circuits to a stub.
 *
 *   PATCH /api/users/delegation
 *           body: { walletAddress, privyWalletId?, delegationActive }
 *           Persists the user's opt-in. The Privy delegation grant itself
 *           happens client-side (useDelegatedActions); this endpoint
 *           records that the user has agreed so the ws-server Order
 *           Tracker knows it can call the Privy server signer.
 *
 * Auth: Privy access token. Identity comes from the verified token, never
 * from the request body.
 */

export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ delegationActive: false, privyWalletId: null, demo: true });
  }
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { delegationActive: true, privyWalletId: true },
  });
  return NextResponse.json({
    delegationActive: user?.delegationActive ?? false,
    privyWalletId: user?.privyWalletId ?? null,
  });
}

const PatchSchema = z.object({
  walletAddress: z.string().min(1),
  privyWalletId: z.string().optional(),
  delegationActive: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (isDemoServer()) {
    return NextResponse.json({ ok: true, demo: true, ...parsed.data });
  }

  const ctx = await requireAuthOrUpsert(req, parsed.data.walletAddress);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await prisma.user.update({
    where: { id: ctx.userId },
    data: {
      ...(parsed.data.privyWalletId ? { privyWalletId: parsed.data.privyWalletId } : {}),
      delegationActive: parsed.data.delegationActive,
    },
    select: { delegationActive: true, privyWalletId: true },
  });

  return NextResponse.json({
    ok: true,
    delegationActive: user.delegationActive,
    privyWalletId: user.privyWalletId,
  });
}
