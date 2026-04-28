import { NextResponse } from 'next/server';
import { makeDemoSignal } from '@hunch-it/shared';
import { isDemoServer } from '@/lib/demo/flag';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * v1.3 transition: legacy Signal cold-read only — used by /signals/<id> in
 * demo mode for fresh page loads. Live mode returns 410; consumers should
 * move to /api/proposals/<id> in Phase B.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  if (isDemoServer()) {
    const signal = { ...makeDemoSignal(Math.abs(hash(id))), id };
    return NextResponse.json({ signal, source: 'demo' });
  }
  return NextResponse.json(
    { error: 'GET /api/signals/[id] is deprecated; use /api/proposals/[id]' },
    { status: 410 },
  );
}
