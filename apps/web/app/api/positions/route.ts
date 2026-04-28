import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * GET /api/positions
 * Returns all of the authed user's non-CLOSED positions.
 *
 * Demo mode: positions are managed in-memory by useDemoPositionsStore on the
 * client; returns an empty array.
 */
export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ positions: [] });
  }
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const positions = await prisma.position.findMany({
    where: { userId: auth.userId, state: { not: 'CLOSED' } },
    orderBy: { firstEntryAt: 'desc' },
  });
  return NextResponse.json({ positions: decimalsToNumbers(positions) });
}
