import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * GET /api/positions/[id]
 * Live mode: returns the Position (with related orders) — must belong to the
 * authed user.
 * Demo: returns 404 — the page reads from useDemoPositionsStore.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  if (isDemoServer()) {
    return NextResponse.json({ error: 'demo positions live in client store only' }, { status: 404 });
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const position = await prisma.position.findUnique({
    where: { id },
    include: { orders: true },
  });
  if (!position || position.userId !== auth.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ position: decimalsToNumbers(position) });
}
