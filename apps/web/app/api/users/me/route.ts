import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';

/**
 * GET /api/users/me
 *
 * Single source of truth for the signed-in user's profile flags. We had
 * /api/users/delegation already returning delegation state; centralising
 * here means future flags (trial expiry, onboarding completion, daily
 * cap left, etc.) get ONE place to live and the client can hydrate the
 * settings + onboarding redirects from a single round-trip.
 *
 * Demo mode returns a stub so the cold-tour UX renders identically.
 */
export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({
      demo: true,
      walletAddress: 'demo-wallet',
      delegationActive: false,
      privyWalletId: null,
      hasMandate: true, // demo mandate is always present
      createdAt: new Date(0).toISOString(),
    });
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      walletAddress: true,
      privyWalletId: true,
      delegationActive: true,
      createdAt: true,
      mandate: { select: { id: true } },
    },
  });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    demo: false,
    walletAddress: user.walletAddress,
    privyWalletId: user.privyWalletId,
    delegationActive: user.delegationActive,
    hasMandate: !!user.mandate,
    createdAt: user.createdAt.toISOString(),
  });
}
