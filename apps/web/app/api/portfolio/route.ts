import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/context';
import { readSolBalance, readUsdcBalance } from '@/lib/solana/usdc-balance';
import { getCurrentPrices } from '@/lib/pyth';
import { buildPortfolioResponse } from '@/lib/portfolio/summary';

/**
 * GET /api/portfolio
 *
 * Live: aggregates positions (open + closed) + recent trades for the authed
 * user. PnL is split into realized (sum of Trade.realizedPnl on closed
 * legs) and unrealized (sum of (markPrice - entryPrice) * tokenAmount on
 * ACTIVE / ENTERING / BUY_PENDING positions).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
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

  const assetIds = Array.from(new Set(openPositions.map((position) => position.ticker)));
  const markPrices =
    assetIds.length > 0
      ? await getCurrentPrices(assetIds).catch(() => new Map<string, number>())
      : new Map<string, number>();

  return NextResponse.json(
    buildPortfolioResponse({
      positions: openPositions,
      trades: recentTrades,
      markPrices,
      cashUsd,
      solBalance,
    }),
  );
}
