import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * GET /api/positions/[id]
 * Live mode: looks up Position by id (with related orders).
 * Demo: returns 404 — the page should read from useDemoPositionsStore.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  if (isDemoServer()) {
    return NextResponse.json({ error: 'demo positions live in client store only' }, { status: 404 });
  }

  const position = await prisma.position.findUnique({
    where: { id },
    include: { orders: true },
  });
  if (!position) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ position });
}
