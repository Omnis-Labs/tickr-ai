import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * GET /api/positions?wallet=<address>
 * Returns all of the user's non-CLOSED positions.
 *
 * Demo mode: positions are managed in-memory by useDemoPositionsStore on the
 * client (server can't see them). Returns an empty array — the page should
 * read straight from the Zustand store in demo.
 */
export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ positions: [] });
  }
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) return NextResponse.json({ positions: [] });

  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!user) return NextResponse.json({ positions: [] });

  const positions = await prisma.position.findMany({
    where: { userId: user.id, state: { not: 'CLOSED' } },
    orderBy: { firstEntryAt: 'desc' },
  });
  return NextResponse.json({ positions });
}
