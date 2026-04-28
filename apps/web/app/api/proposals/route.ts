import { NextResponse, type NextRequest } from 'next/server';
import { demoInitialProposals } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * GET /api/proposals
 * Returns the authed user's ACTIVE proposals (sorted by expiresAt asc).
 *
 * Demo mode: returns 4 hand-crafted demo proposals so the home page renders
 * a populated feed even before the demo loop has emitted anything.
 */
export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ proposals: demoInitialProposals(4) });
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const proposals = await prisma.proposal.findMany({
    where: {
      userId: auth.userId,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });

  return NextResponse.json({ proposals: decimalsToNumbers(proposals) });
}
