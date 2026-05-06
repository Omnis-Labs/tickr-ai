import 'server-only';
import { prisma } from '@/lib/db';
import { verifyPrivyToken } from './privy';

/**
 * Per-request auth context resolved by every protected API route.
 *
 *   const ctx = await requireAuth(req);
 *   if (!ctx) return NextResponse.json({error:'unauthorized'}, {status:401});
 *   // ctx.userId is our internal User.id
 *
 */
export interface AuthContext {
  userId: string; // our User.id (cuid)
  walletAddress: string;
  privyUserId: string | null;
}

export async function requireAuth(req: Request): Promise<AuthContext | null> {
  const claims = await verifyPrivyToken(req);
  if (!claims) return null;

  // Linked-account walletAddress is *not* in the verifyAuthToken claims; we
  // only have the canonical Privy userId. The frontend writes walletAddress
  // on User upserts elsewhere (POST /api/mandates, /api/users/delegation),
  // and the socket auth flow does the same. Here we only need .id + linked
  // wallet (may be null for first-touch).
  const user = await prisma.user.findUnique({
    where: { privyUserId: claims.userId },
  });
  if (!user) return null;
  return {
    userId: user.id,
    walletAddress: user.walletAddress,
    privyUserId: user.privyUserId,
  };
}

/**
 * Variant for routes that allow first-touch user creation. Caller must
 * provide walletAddress (e.g. mandate-setup posts it). Idempotent.
 */
export async function requireAuthOrUpsert(
  req: Request,
  walletAddress: string,
): Promise<AuthContext | null> {
  const claims = await verifyPrivyToken(req);
  if (!claims) return null;

  const user = await prisma.user.upsert({
    where: { privyUserId: claims.userId },
    update: { walletAddress },
    create: {
      privyUserId: claims.userId,
      walletAddress,
    },
  });
  return {
    userId: user.id,
    walletAddress: user.walletAddress,
    privyUserId: user.privyUserId,
  };
}
