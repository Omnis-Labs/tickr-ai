import { NextResponse } from 'next/server';

/**
 * v1.3 transition: the legacy Trade insertion flow (Jupiter Ultra -> POST
 * /api/trades) is gone. The current flow settles trades through
 * /api/orders/[id]/execute or /api/positions/[id]/close.
 *
 * Returns 501 until the legacy route is rebuilt around the current
 * synthetic-trigger lifecycle.
 */

export async function GET() {
  return NextResponse.json(
    { error: 'POST /api/trades is retired; use order execution or position close routes' },
    { status: 501 },
  );
}

export async function POST() {
  return NextResponse.json(
    { error: 'POST /api/trades is retired; use order execution or position close routes' },
    { status: 501 },
  );
}
