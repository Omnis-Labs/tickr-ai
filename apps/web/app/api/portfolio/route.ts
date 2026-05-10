import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';
import { readSolBalance, readUsdcBalance } from '@/lib/solana/usdc-balance';
import { getCurrentPrices } from '@/lib/pyth';
import { applyMarkPricesToPortfolioPositions } from '@/lib/portfolio/holdings';
import type { PortfolioResponse } from '@/lib/hooks/queries';

/**
 * GET /api/portfolio
 *
 * Live: aggregates positions (open + closed) + recent trades for the authed
 * user. PnL is split into realized (sum of Trade.realizedPnl on closed
 * legs) and unrealized (sum of (markPrice - entryPrice) * tokenAmount on
 * ACTIVE / ENTERING / BUY_PENDING positions).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const freshBalances = req.nextUrl.searchParams.get('freshBalances') === '1';
  const balanceReadOptions = {
    forceFresh: freshBalances,
    throwOnFailure: freshBalances,
  };

  const [openPositions, recentTrades, cashUsd, solBalance] = await Promise.all([
    prisma.position.findMany({
      where: { userId: auth.userId, state: { not: 'CLOSED' } },
      include: {
        orders: {
          where: {
            kind: 'BUY_TRIGGER',
            status: { in: ['OPEN', 'PENDING'] },
          },
          select: { sizeUsd: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { firstEntryAt: 'desc' },
    }),
    prisma.trade.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    // RPC read of the user's embedded-wallet USDC balance. Cached 60s
    // per wallet inside the helper so the desk page's 15s portfolio
    // refetch doesn't pound the RPC. Returns 0 on failure.
    readUsdcBalance(auth.walletAddress, balanceReadOptions),
    readSolBalance(auth.walletAddress, balanceReadOptions),
  ]);

  // Realized PnL = sum of all SELL-side Trade.realizedPnl (BUY trades have
  // realizedPnl=null; SELL legs carry the per-position outcome).
  const realized = recentTrades.reduce((acc, t) => {
    const v = t.realizedPnl == null ? 0 : t.realizedPnl.toNumber();
    return acc + v;
  }, 0);

  const basePositions: PortfolioResponse['positions'] = openPositions.map((p) => {
    const tokenAmount = p.tokenAmount.toNumber();
    const entryPrice = p.entryPrice.toNumber();
    const pendingSizeUsd = p.orders[0]?.sizeUsd.toNumber();
    return {
      id: p.id,
      ticker: p.ticker,
      tokenAmount,
      avgCost: entryPrice,
      markPrice: entryPrice,
      pnl: 0,
      pendingSizeUsd,
      state: p.state,
    };
  });

  const assetIds = Array.from(new Set(basePositions.map((p) => p.ticker)));
  const markPrices =
    assetIds.length > 0
      ? await getCurrentPrices(assetIds).catch(() => new Map<string, number>())
      : new Map<string, number>();
  const { positions, unrealized } = applyMarkPricesToPortfolioPositions(
    basePositions,
    markPrices,
  );

  const trades = recentTrades.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    side: t.side as 'BUY' | 'SELL',
    amountUsd: t.actualSizeUsd.toNumber(),
    tokenAmount: t.filledAmount?.toNumber() ?? 0,
    executionPrice: t.executionPrice?.toNumber() ?? 0,
    txSignature: '', // not stored on Trade; the originating Order has it
    status: 'CONFIRMED',
    realizedPnl: t.realizedPnl?.toNumber() ?? 0,
    createdAt: t.createdAt.toISOString(),
  }));

  return NextResponse.json({
    positions: decimalsToNumbers(positions),
    trades,
    pnl: { realized, unrealized },
    cashUsd,
    solBalance,
  });
}
