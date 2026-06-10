import { NextResponse } from 'next/server';
import { cancelOpenOrder, prisma } from '@hunch-it/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/orders/[id]/cancel
 *
 * Cancel an OPEN synthetic order. The PositionLifecycle module owns all Order
 * writes: BUY_TRIGGER cancellation closes the parent BUY_PENDING Position, and
 * TAKE_PROFIT / STOP_LOSS cancellation only closes the selected synthetic leg.
 *
 * Auth: Privy access token. Order must belong to the authed user.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await cancelOpenOrder({ userId: auth.userId, orderId: id });
  if (result.status === 'conflict') {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === 'order_not_found' ? 404 : 409 },
    );
  }
  const order = await prisma.order.findUnique({ where: { id } });
  return NextResponse.json({ ok: true, order: decimalsToNumbers(order) });
}
