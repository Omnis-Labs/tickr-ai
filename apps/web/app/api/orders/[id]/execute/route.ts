import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { confirmBuyFill, confirmExitFill, prisma } from '@hunch-it/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/orders/[id]/execute
 *
 * Settle a synthetic xStock order after the user (or future server signer)
 * executed the Ultra swap. The route auths, validates input, then delegates
 * the entire DB transition to the PositionLifecycle module — which owns
 * atomicity (BUY fill + Position ACTIVE + Trade + arm TP/SL all in one txn,
 * exit fill + cancel sibling + Position CLOSED + Trade in one txn) and
 * idempotency (Order.txSignature is unique; duplicate replay returns 200 with
 * `duplicate: true` instead of double-writing).
 *
 * Auth: Privy access token. Order must belong to the authed user.
 */
const Schema = z.object({
  txSignature: z.string().min(1),
  executionPrice: z.number().positive(),
  tokenAmount: z.number().positive(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, userId: true, kind: true },
  });
  if (!order || order.userId !== auth.userId) {
    return NextResponse.json({ error: 'order not found' }, { status: 404 });
  }

  const { txSignature, executionPrice, tokenAmount } = parsed.data;

  if (order.kind === 'BUY_TRIGGER') {
    const result = await confirmBuyFill({
      userId: auth.userId,
      orderId: id,
      txSignature,
      executionPrice,
      tokenAmount,
    });
    if (result.status === 'conflict') {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    const updated = await prisma.order.findUnique({ where: { id } });
    return NextResponse.json({
      ok: true,
      duplicate: result.status === 'duplicate',
      order: decimalsToNumbers(updated),
    });
  }

  if (order.kind === 'TAKE_PROFIT' || order.kind === 'STOP_LOSS') {
    const result = await confirmExitFill({
      userId: auth.userId,
      orderId: id,
      txSignature,
      executionPrice,
      tokenAmount,
    });
    if (result.status === 'conflict') {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    const updated = await prisma.order.findUnique({ where: { id } });
    return NextResponse.json({
      ok: true,
      duplicate: result.status === 'duplicate',
      order: decimalsToNumbers(updated),
    });
  }

  return NextResponse.json(
    { error: `cannot execute order kind ${order.kind} via this route` },
    { status: 400 },
  );
}
