import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/orders/[id]/execute
 *
 * Settle a synthetic xStock order after the user (or future server
 * signer) executed the Ultra swap. We mark the Order FILLED, write a
 * Trade row, and update the Position state — the lifecycle the
 * Jupiter tracker would normally drive for v2 orders, except here the
 * user/server did the swap themselves so we just record the outcome.
 *
 * Request body:
 *   txSignature       — Solana tx signature of the Ultra swap.
 *   executionPrice    — USD per unit, computed from input/output amounts.
 *   tokenAmount       — xStock units bought (BUY) or sold (TP/SL).
 *
 * State transitions:
 *   BUY_TRIGGER  → Position.state BUY_PENDING → ACTIVE  (entryPrice set,
 *                  tokenAmount accumulated, totalCost recorded)
 *   TAKE_PROFIT  → Position.state ACTIVE → CLOSED, realizedPnl recorded;
 *                  the SL Order on the same position flipped to CANCELLED
 *   STOP_LOSS    → mirror of TAKE_PROFIT
 *
 * Auth: Privy access token. Order must belong to the authed user.
 */

const Schema = z.object({
  txSignature: z.string().min(1),
  executionPrice: z.number().positive(),
  tokenAmount: z.number().positive(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (isDemoServer()) return NextResponse.json({ ok: true, demo: true });

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
    include: { position: true },
  });
  if (!order || order.userId !== auth.userId) {
    return NextResponse.json({ error: 'order not found' }, { status: 404 });
  }
  if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') {
    return NextResponse.json(
      { error: `order is ${order.status}, cannot execute` },
      { status: 409 },
    );
  }

  const { txSignature, executionPrice, tokenAmount } = parsed.data;
  const sizeUsd = order.sizeUsd.toNumber();

  await prisma.order.update({
    where: { id },
    data: {
      status: 'FILLED',
      filledAmount: tokenAmount,
      executionPrice,
      txSignature,
      filledAt: new Date(),
    },
  });

  if (order.kind === 'BUY_TRIGGER') {
    // BUY filled — promote Position to ACTIVE with the actual fill data.
    const totalCost = executionPrice * tokenAmount;
    await prisma.position.update({
      where: { id: order.positionId },
      data: {
        state: 'ACTIVE',
        entryPrice: executionPrice,
        tokenAmount,
        totalCost,
      },
    });

    await prisma.trade.create({
      data: {
        userId: auth.userId,
        positionId: order.positionId,
        ticker: order.position.ticker,
        side: 'BUY',
        source: 'BUY_APPROVAL',
        actualSizeUsd: sizeUsd,
        actualTriggerPrice: order.triggerPriceUsd,
        executionPrice,
        filledAmount: tokenAmount,
      },
    });

    // Auto-arm the synthetic TP/SL pair the user picked at proposal time.
    // Stored on the Position as currentTpPrice / currentSlPrice when the
    // BUY_TRIGGER row was first created in /api/orders. We need the
    // matching Order rows for trigger-monitor to watch them; without
    // this step, an ACTIVE position would have no exit legs and the
    // monitor would never fire on TP/SL.
    const tp = order.position.currentTpPrice?.toNumber();
    const sl = order.position.currentSlPrice?.toNumber();
    const exitLegs: Array<{
      kind: 'TAKE_PROFIT' | 'STOP_LOSS';
      triggerPriceUsd: number;
    }> = [];
    if (tp != null && tp > 0) exitLegs.push({ kind: 'TAKE_PROFIT', triggerPriceUsd: tp });
    if (sl != null && sl > 0) exitLegs.push({ kind: 'STOP_LOSS', triggerPriceUsd: sl });
    for (const leg of exitLegs) {
      await prisma.order.create({
        data: {
          userId: auth.userId,
          positionId: order.positionId,
          kind: leg.kind,
          side: 'SELL',
          triggerPriceUsd: leg.triggerPriceUsd,
          // Notional value at the trigger price — recorded for analytics;
          // the actual sell sizes the wallet's full xStock balance via
          // Ultra at execute time, so this is informational only.
          sizeUsd: leg.triggerPriceUsd * tokenAmount,
          tokenAmount,
          status: 'OPEN',
          // Synthetic — no Jupiter routing.
          jupiterOrderId: null,
        },
      });
    }
  } else if (order.kind === 'TAKE_PROFIT' || order.kind === 'STOP_LOSS') {
    const entryPrice = order.position.entryPrice.toNumber();
    const realizedPnl = (executionPrice - entryPrice) * tokenAmount;
    await prisma.position.update({
      where: { id: order.positionId },
      data: {
        state: 'CLOSED',
        closedAt: new Date(),
        closedReason: order.kind === 'TAKE_PROFIT' ? 'TP_FILLED' : 'SL_FILLED',
        realizedPnl: new Prisma.Decimal(realizedPnl),
      },
    });

    // Cancel the sibling exit leg — only one of TP/SL can win.
    await prisma.order.updateMany({
      where: {
        positionId: order.positionId,
        kind: order.kind === 'TAKE_PROFIT' ? 'STOP_LOSS' : 'TAKE_PROFIT',
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      },
      data: { status: 'CANCELLED' },
    });

    await prisma.trade.create({
      data: {
        userId: auth.userId,
        positionId: order.positionId,
        ticker: order.position.ticker,
        side: 'SELL',
        source: order.kind === 'TAKE_PROFIT' ? 'TP_FILL' : 'SL_FILL',
        actualSizeUsd: sizeUsd,
        actualTriggerPrice: order.triggerPriceUsd,
        executionPrice,
        filledAmount: tokenAmount,
        realizedPnl: new Prisma.Decimal(realizedPnl),
      },
    });
  }

  const updated = await prisma.order.findUnique({ where: { id } });
  return NextResponse.json({ ok: true, order: decimalsToNumbers(updated) });
}
