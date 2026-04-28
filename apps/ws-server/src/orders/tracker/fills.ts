// Fill reconciliation — when Jupiter History reports an order moved to
// FILLED / PARTIALLY_FILLED, mirror the fill into our Order + Position rows
// and emit the matching socket event. Includes the OCO sibling cancel branch
// for TP / SL pairs and writes a Trade row per fill so leaderboard /
// portfolio aggregation has a consistent source of truth.

import type { Prisma, PrismaClient, TradeSource } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import { WsServerEvents, getAssetById } from '@hunch-it/shared';
import { tryDelegatedCancel } from './oco.js';
import type { JupiterHistoryEntry } from './jupiter-history.js';

export type OrderForFill = Awaited<ReturnType<PrismaClient['order']['findMany']>>[number] & {
  user: {
    walletAddress: string;
    privyWalletId: string | null;
    delegationActive: boolean;
  } | null;
  position: {
    id: string;
    ticker: string;
    tokenAmount: Prisma.Decimal;
    entryPrice: Prisma.Decimal;
  };
};

/**
 * Look up token decimals via the asset registry. xStocks are 8, SOL is 9,
 * cbBTC is 8 — falls back to 8 only as a defensive default for unknown
 * assetIds (logs a warning so it doesn't go silent).
 */
function decimalsForAsset(assetId: string): number {
  const a = getAssetById(assetId);
  if (a) return a.decimals;
  console.warn(`[tracker] unknown assetId ${assetId} — defaulting decimals=8`);
  return 8;
}

function tradeSourceForKind(kind: string): TradeSource {
  if (kind === 'BUY_TRIGGER') return 'BUY_APPROVAL';
  if (kind === 'TAKE_PROFIT') return 'TP_FILL';
  if (kind === 'STOP_LOSS') return 'SL_FILL';
  return 'USER_CLOSE';
}

export async function applyFill(
  prisma: PrismaClient,
  io: IoServer,
  order: OrderForFill,
  remote: JupiterHistoryEntry,
): Promise<void> {
  const decimals = decimalsForAsset(order.position.ticker);
  const filledAmount = remote.filledAmount ? Number(remote.filledAmount) : null;
  const inAmount = remote.inAmount ? Number(remote.inAmount) : null;
  const outAmount = remote.outAmount ? Number(remote.outAmount) : null;
  const executionPrice =
    inAmount && outAmount && outAmount > 0 ? inAmount / outAmount : null;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: remote.status === 'FILLED' ? 'FILLED' : 'PARTIALLY_FILLED',
      filledAmount,
      executionPrice,
      filledAt: remote.filledAt ? new Date(remote.filledAt * 1000) : new Date(),
    },
  });

  // Per-fill Trade row. We emit one for any FILLED transition (not partial)
  // so leaderboard counts each closed leg exactly once.
  if (remote.status === 'FILLED' && order.user && executionPrice) {
    const isBuy = order.kind === 'BUY_TRIGGER';
    // outAmount on a BUY is the xStock acquired; on a SELL it's the USDC out.
    const tokenAmt = isBuy
      ? (outAmount ?? 0) / 10 ** decimals
      : (inAmount ?? 0) / 10 ** decimals;
    const sizeUsd = isBuy
      ? (inAmount ?? 0) / 10 ** 6 // USDC has 6 decimals
      : (outAmount ?? 0) / 10 ** 6;
    const realizedPnl = isBuy
      ? null
      : (executionPrice - order.position.entryPrice.toNumber()) * tokenAmt;

    await prisma.trade
      .create({
        data: {
          userId: order.userId,
          positionId: order.positionId,
          ticker: order.position.ticker,
          side: order.side,
          source: tradeSourceForKind(order.kind),
          actualSizeUsd: sizeUsd,
          actualTriggerPrice: order.triggerPriceUsd,
          executionPrice,
          filledAmount: tokenAmt,
          realizedPnl,
        },
      })
      .catch((err) => {
        console.warn(`[tracker] trade create failed for order ${order.id}`, err);
      });
  }

  if (order.kind === 'BUY_TRIGGER' && remote.status === 'FILLED' && executionPrice) {
    // BUY filled → Position transitions to ENTERING. The user places TP/SL
    // next via Position Detail.
    const tokenAmount = outAmount ? outAmount / 10 ** decimals : 0;
    await prisma.position.update({
      where: { id: order.positionId },
      data: {
        state: 'ENTERING',
        entryPrice: executionPrice,
        tokenAmount,
        totalCost: tokenAmount * executionPrice,
      },
    });
  }

  if (
    (order.kind === 'TAKE_PROFIT' || order.kind === 'STOP_LOSS') &&
    remote.status === 'FILLED'
  ) {
    const tokenAmount = order.position.tokenAmount.toNumber();
    const realizedPnl = executionPrice
      ? (executionPrice - order.position.entryPrice.toNumber()) * tokenAmount
      : 0;
    await prisma.position.update({
      where: { id: order.positionId },
      data: {
        state: 'CLOSED',
        closedAt: new Date(),
        closedReason: order.kind === 'TAKE_PROFIT' ? 'TP_FILLED' : 'SL_FILLED',
        realizedPnl,
      },
    });

    const sibling = await prisma.order.findFirst({
      where: {
        positionId: order.positionId,
        kind: order.kind === 'TAKE_PROFIT' ? 'STOP_LOSS' : 'TAKE_PROFIT',
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      },
    });
    if (sibling && order.user) {
      const delegated =
        order.user.delegationActive && order.user.privyWalletId
          ? await tryDelegatedCancel(prisma, sibling.jupiterOrderId ?? '', order.user.privyWalletId)
          : false;

      io.to(`user:${order.user.walletAddress}`).emit(WsServerEvents.PositionUpdated, {
        positionId: order.positionId,
        state: 'CLOSED',
        action: delegated ? 'sibling-cancelled' : 'cancel-sibling',
        siblingOrderId: sibling.id,
        siblingKind: sibling.kind,
      });

      if (delegated) {
        console.log(
          `[tracker] auto-cancelled sibling ${sibling.kind} (jup=${sibling.jupiterOrderId}) for ${order.user.walletAddress.slice(0, 6)}…`,
        );
      }
    }
  }

  if (order.user) {
    io.to(`user:${order.user.walletAddress}`).emit(WsServerEvents.TradeFilled, {
      tradeId: order.id,
      ticker: order.position.ticker,
      side: order.side,
      executionPrice,
      tokenAmount: outAmount,
    });
  }
}
