import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/positions/[id]/close
 *
 * Per spec §Flow 6 — the client has already cancelled TP/SL trigger orders
 * and market-sold the remaining tokens via Jupiter Ultra. This endpoint just
 * mirrors the result into our Position row so the Order Tracker / portfolio
 * agree.
 *
 * Demo: client-side store does the mutation; the route is a no-op ack.
 */
const ClosePayloadSchema = z.object({
  executionPrice: z.number().positive().nullable().optional(),
  tokenAmount: z.number().nonnegative().nullable().optional(),
  txSignature: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isDemoServer()) return NextResponse.json({ ok: true, demo: true });
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = ClosePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { executionPrice, tokenAmount } = parsed.data;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const pos = await prisma.position.findUnique({ where: { id } });
  if (!pos || pos.userId !== auth.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // pos.entryPrice is now Prisma.Decimal — convert to number for the simple
  // PnL formula. For finer precision we'd hold off on .toNumber() until the
  // very end, but USD pennies of slippage is acceptable at this layer.
  const realizedPnl =
    executionPrice != null && tokenAmount != null
      ? (executionPrice - pos.entryPrice.toNumber()) * tokenAmount
      : 0;

  const updated = await prisma.position.update({
    where: { id },
    data: {
      state: 'CLOSED',
      closedAt: new Date(),
      closedReason: 'USER_CLOSE',
      realizedPnl,
    },
  });

  // Mirror as a Trade row so portfolio + leaderboard see the close. Trades
  // from the Order Tracker land via the same shape from fills.ts; this is
  // the only path where a user-initiated market-sell short-circuits the
  // tracker (no Jupiter trigger order to reconcile).
  if (executionPrice != null && tokenAmount != null) {
    await prisma.trade
      .create({
        data: {
          userId: auth.userId,
          positionId: id,
          ticker: pos.ticker,
          side: 'SELL',
          source: 'USER_CLOSE',
          actualSizeUsd: executionPrice * tokenAmount,
          executionPrice,
          filledAmount: tokenAmount,
          realizedPnl,
        },
      })
      .catch(() => {
        /* non-fatal — position close already committed */
      });
  }

  return NextResponse.json({ ok: true, position: decimalsToNumbers(updated) });
}
