import { NextResponse, type NextRequest } from 'next/server';
import { expireActiveProposals, prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * GET /api/proposals
 * Returns the authed user's ACTIVE proposals (sorted by expiresAt asc).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date();
  await expireActiveProposals(prisma, { userId: auth.userId, now });

  const proposals = await prisma.proposal.findMany({
    where: {
      userId: auth.userId,
      status: 'ACTIVE',
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });

  return NextResponse.json({ proposals: decimalsToNumbers(proposals) });
}
