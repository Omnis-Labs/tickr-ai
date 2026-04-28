import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * PATCH /api/users/delegation
 * body: { walletAddress, privyUserId?, privyWalletId?, delegationActive }
 *
 * Persists the user's delegated-signing opt-in state. The actual delegation
 * grant is done client-side via Privy's useDelegatedActions; this endpoint
 * just records that the user has agreed so the ws-server Order Tracker /
 * auto TP/SL placement code knows it can call the Privy server signer.
 *
 * Demo mode: returns ok without DB write.
 */
const Schema = z.object({
  walletAddress: z.string().min(1),
  privyUserId: z.string().optional(),
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

  const { walletAddress, privyUserId, privyWalletId, delegationActive } = parsed.data;

  const user = await prisma.user.upsert({
    where: { walletAddress },
    update: {
      ...(privyUserId ? { privyUserId } : {}),
      ...(privyWalletId ? { privyWalletId } : {}),
      delegationActive,
    },
    create: {
      walletAddress,
      privyUserId: privyUserId ?? null,
      privyWalletId: privyWalletId ?? null,
      delegationActive,
    },
  });

  return NextResponse.json({
    ok: true,
    delegationActive: user.delegationActive,
  });
}
