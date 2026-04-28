import { NextResponse } from 'next/server';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * POST /api/positions/[id]/close
 *
 * Per spec §Flow 6 — cancel TP/SL trigger orders, then market-sell remaining
 * tokens via Jupiter Swap, then mark Position state=CLOSED.
 *
 * Demo: the client's useDemoPositionsStore.closePosition mutates state
 * directly. This endpoint just acks.
 *
 * Live: 501 until Phase D wires the Jupiter Swap + Trigger Order cancel flow.
 */
export async function POST(_req: Request, _ctx: { params: Promise<{ id: string }> }) {
  if (isDemoServer()) {
    return NextResponse.json({ ok: true, demo: true });
  }
  return NextResponse.json(
    {
      error:
        'POST /api/positions/[id]/close is wired in Phase D (Jupiter Trigger Order cancel + Swap)',
    },
    { status: 501 },
  );
}
