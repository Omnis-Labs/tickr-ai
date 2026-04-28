import { NextResponse } from 'next/server';

/**
 * v1.3 transition: the legacy Signal table is gone. Per-user proposals will
 * be served by `/api/proposals` once the Proposal Generator lands (Phase B).
 */
export async function GET() {
  return NextResponse.json(
    { error: 'GET /api/signals is deprecated; use /api/proposals (coming in Phase B)' },
    { status: 410 },
  );
}
