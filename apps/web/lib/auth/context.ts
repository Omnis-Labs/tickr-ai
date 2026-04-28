import 'server-only';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { verifyPrivyToken } from './privy';

/**
 * Per-request auth context resolved by every protected API route.
 *
 *   const ctx = await requireAuth(req);
 *   if (!ctx) return NextResponse.json({error:'unauthorized'}, {status:401});
 *   // ctx.userId is our internal User.id
 *
 * Demo mode short-circuits to a pre-seeded demo user — keeps the zero-cred
 * UX path working without a Privy session.
 */
export interface AuthContext {
  userId: string; // our User.id (cuid)
  walletAddress: string;
  privyUserId: string | null;
  demo: boolean;
}

const DEMO_PRIVY_ID = 'did:privy:demo-user';
const DEMO_WALLET = 'demo-wallet';

async function getDemoContext(): Promise<AuthContext> {
  const user = await prisma.user.upsert({
    where: { walletAddress: DEMO_WALLET },
    update: {},
    create: {
      privyUserId: DEMO_PRIVY_ID,
      walletAddress: DEMO_WALLET,
    },
  });
  return {
    userId: user.id,
    walletAddress: user.walletAddress,
    privyUserId: user.privyUserId,
    demo: true,
  };
}

export async function requireAuth(req: Request): Promise<AuthContext | null> {
  if (isDemoServer()) {
    return getDemoContext();
  }

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
    demo: false,
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
  if (isDemoServer()) return getDemoContext();
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
    demo: false,
  };
}
