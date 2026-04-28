import { NextResponse, type NextRequest } from 'next/server';
import { demoInitialPositions, demoInitialTrades } from '@hunch-it/shared';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';

/**
 * v1.3 transition: portfolio aggregation will be reimplemented against the
 * new Position / Trade / Order tables once the Trigger Order pipeline lands
 * (Phase C/D). Until then this endpoint serves demo fixtures only.
 */
export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    const positions = demoInitialPositions();
    const trades = demoInitialTrades();
    const realized = trades
      .filter((t) => t.side === 'SELL' && t.status === 'CONFIRMED')
      .reduce((acc, t) => acc + t.realizedPnl, 0);
    const unrealized = positions.reduce((acc, p) => acc + (p.pnl ?? 0), 0);
    return NextResponse.json({ positions, trades, pnl: { realized, unrealized } });
  }
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(
    { error: 'GET /api/portfolio is being rebuilt against v1.3 Position/Trade tables' },
    { status: 501 },
  );
}
