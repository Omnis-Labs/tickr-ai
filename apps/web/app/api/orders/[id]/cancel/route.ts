import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/orders/[id]/cancel
 *
 * Marks an order CANCELLED in our DB. After the synthetic-trigger pivot
 * (xStocks aren't on Jupiter Trigger v2's allowlist), our exit Orders
 * carry `jupiterOrderId IS NULL` — there's no off-chain escrow to
 * release, this single DB write is the whole cancel. For BUY_TRIGGER
 * cancels we also close the parent Position so /desk doesn't keep
 * showing a "watching" row the user already abandoned.
 *
 * Auth: Privy access token; the order must belong to the authed user.
 * Demo: returns ok.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isDemoServer()) return NextResponse.json({ ok: true, demo: true });
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing || existing.userId !== auth.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const order = await prisma.order.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });

  // If the cancelled order was a BUY trigger and the position is still pending,
  // close the position record too — vault funds returned to wallet.
  if (order.kind === 'BUY_TRIGGER') {
    await prisma.position
      .update({
        where: { id: order.positionId },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          closedReason: 'USER_CLOSE',
          realizedPnl: 0,
        },
      })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, order: decimalsToNumbers(order) });
}
