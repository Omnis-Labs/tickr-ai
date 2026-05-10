import { NextResponse } from 'next/server';

/**
 * v1.3 transition: legacy Signal cold-read only. Consumers should move to
 * /api/proposals/[id].
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  return NextResponse.json(
    { error: 'GET /api/signals/[id] is deprecated; use /api/proposals/[id]' },
    { status: 410 },
  );
}
