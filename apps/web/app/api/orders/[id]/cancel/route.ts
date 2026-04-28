import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';

/**
 * POST /api/orders/[id]/cancel
 *
 * Records that an order has been cancelled on-chain. The actual Jupiter
 * cancel flow (initiate → sign withdrawal → confirm) runs client-side via
 * useJupiterTrigger().cancel — this endpoint is just the persistence ack.
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

  return NextResponse.json({ ok: true, order });
}
