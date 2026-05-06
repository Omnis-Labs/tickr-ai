import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * GET /api/positions
 * Returns all of the authed user's non-CLOSED positions.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const positions = await prisma.position.findMany({
    where: { userId: auth.userId, state: { not: 'CLOSED' } },
    orderBy: { firstEntryAt: 'desc' },
  });
  return NextResponse.json({ positions: decimalsToNumbers(positions) });
}
