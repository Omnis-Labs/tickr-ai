import { NextResponse, type NextRequest } from 'next/server';
import { demoInitialProposals } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * GET /api/proposals?wallet=<address>
 * Returns the user's ACTIVE proposals (sorted by expiresAt asc).
 *
 * Demo mode: returns 4 hand-crafted demo proposals so the home page renders
 * a populated feed even before the demo loop has emitted anything.
 */
export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ proposals: demoInitialProposals(4) });
  }

  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) return NextResponse.json({ proposals: [] });

  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!user) return NextResponse.json({ proposals: [] });

  const proposals = await prisma.proposal.findMany({
    where: {
      userId: user.id,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });

  return NextResponse.json({ proposals });
}
