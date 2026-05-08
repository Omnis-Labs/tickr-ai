import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/context';

/**
 * GET /api/users/me
 *
 * Single source of truth for the signed-in user's profile flags. The
 * SessionGate (server-side funnel resolver) reads `hasMandate` from
 * here to decide whether to send the user to /mandate or /desk; clients
 * can also hydrate settings off the same response.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      walletAddress: true,
      createdAt: true,
      mandate: { select: { id: true } },
    },
  });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    walletAddress: user.walletAddress,
    hasMandate: !!user.mandate,
    createdAt: user.createdAt.toISOString(),
  });
}
