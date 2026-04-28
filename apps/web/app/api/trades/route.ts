import { NextResponse } from 'next/server';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * v1.3 transition: the legacy Trade insertion flow (Jupiter Ultra → POST
 * /api/trades) is gone. The new flow is Proposal → BUY trigger order →
 * Order Tracker writes Trade + Position (Phase C).
 *
 * In demo mode the SignalModal short-circuits to `useDemoStore.appendTrade`
 * so this endpoint isn't reached. In live mode we return 501 until the
 * Trigger Order pipeline lands.
 */

export async function GET() {
  if (isDemoServer()) return NextResponse.json({ trades: [] });
  return NextResponse.json(
    { error: 'POST /api/trades is being rebuilt around Jupiter Trigger Order v2 (Phase C)' },
    { status: 501 },
  );
}

export async function POST() {
  if (isDemoServer()) return NextResponse.json({ ok: true, demo: true });
  return NextResponse.json(
    { error: 'POST /api/trades is being rebuilt around Jupiter Trigger Order v2 (Phase C)' },
    { status: 501 },
  );
}
