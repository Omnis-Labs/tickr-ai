import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuthOrUpsert } from '@/lib/auth/context';

/**
 * PATCH /api/users/delegation
 * body: { walletAddress, privyWalletId?, delegationActive }
 *
 * Persists the user's delegated-signing opt-in state. The actual delegation
 * grant is done client-side via Privy's useDelegatedActions; this endpoint
 * just records that the user has agreed so the ws-server Order Tracker /
 * auto TP/SL placement code knows it can call the Privy server signer.
 *
 * Auth: Privy access token. The user identity comes from the verified token,
 * NOT from the request body. Demo mode short-circuits.
 */
const Schema = z.object({
  walletAddress: z.string().min(1),
  privyWalletId: z.string().optional(),
  delegationActive: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
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
  });

  return NextResponse.json({
    ok: true,
    delegationActive: user.delegationActive,
  });
}
