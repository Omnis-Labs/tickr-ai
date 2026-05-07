import { NextResponse } from 'next/server';
import { cancelPendingBuy, prisma } from '@hunch-it/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/orders/[id]/cancel
 *
 * Cancel an OPEN synthetic order. BUY_TRIGGER cancels delegate to the
 * PositionLifecycle module (cancels Order + closes the parent BUY_PENDING
 * Position atomically). TAKE_PROFIT / STOP_LOSS cancels stay on the raw
 * Prisma path because they're driven by the Adjust-TP/SL client flow,
 * which keeps a cancel+create pair across two requests until C5 lands a
 * dedicated /api/positions/[id]/protection endpoint that calls
 * replaceProtectionOrders.
 *
 * Auth: Privy access token. Order must belong to the authed user.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const existing = await prisma.order.findUnique({
    where: { id },
    select: { id: true, userId: true, kind: true },
  });
  if (!existing || existing.userId !== auth.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (existing.kind === 'BUY_TRIGGER') {
    const result = await cancelPendingBuy({ userId: auth.userId, orderId: id });
    if (result.status === 'conflict') {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    const order = await prisma.order.findUnique({ where: { id } });
    return NextResponse.json({ ok: true, order: decimalsToNumbers(order) });
  }

  const cancelled = await prisma.order.updateMany({
    where: { id, userId: auth.userId, status: 'OPEN' },
    data: { status: 'CANCELLED' },
  });
  if (cancelled.count === 0) {
    const cur = await prisma.order.findUnique({
      where: { id },
      select: { status: true },
    });
    return NextResponse.json(
      { error: cur ? `order_${cur.status.toLowerCase()}` : 'order_not_found' },
      { status: 409 },
    );
  }
  const order = await prisma.order.findUnique({ where: { id } });
  return NextResponse.json({ ok: true, order: decimalsToNumbers(order) });
}
