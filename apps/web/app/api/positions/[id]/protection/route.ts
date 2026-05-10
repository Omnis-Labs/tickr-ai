import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { replaceProtectionOrders, prisma } from '@hunch-it/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * PUT /api/positions/[id]/protection
 *
 * Adjust TP/SL on an ACTIVE position. Replaces the previous client-side
 * cancel-then-create dance against /api/orders that left a window where
 * trigger-monitor could fire on the cancelled-but-not-yet-recreated leg.
 *
 * Body accepts an optional `tpPrice` and/or `slPrice`. If only one is
 * provided, only that leg is replaced; the other stays as-is. The
 * lifecycle cancels matching OPEN exit Orders and creates the new ones in
 * one prisma.\$transaction.
 *
 * Auth: Privy access token. Position must belong to the authed user.
 */
const Schema = z
  .object({
    tpPrice: z.number().positive().optional(),
    slPrice: z.number().positive().optional(),
  })
  .refine((d) => d.tpPrice != null || d.slPrice != null, {
    message: 'at least one of tpPrice / slPrice required',
  });

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await replaceProtectionOrders({
    userId: auth.userId,
    positionId: id,
    tpPrice: parsed.data.tpPrice,
    slPrice: parsed.data.slPrice,
  });

  if (result.status === 'conflict') {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  if (result.status !== 'success') {
    return NextResponse.json({ error: 'unexpected_status' }, { status: 500 });
  }

  const orders = await prisma.order.findMany({
    where: {
      positionId: id,
      kind: { in: ['TAKE_PROFIT', 'STOP_LOSS'] },
      status: 'OPEN',
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    ok: true,
    cancelledOrderIds: result.data.cancelledOrderIds,
    takeProfitOrderId: result.data.takeProfitOrderId,
    stopLossOrderId: result.data.stopLossOrderId,
    openExitOrders: decimalsToNumbers(orders),
  });
}
