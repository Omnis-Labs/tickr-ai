// Fill reconciliation — when Jupiter Trigger v2 reports a fill, mirror
// it into our Order + Position rows and emit the matching socket event.
// v2's native OCO means we no longer call tryDelegatedCancel on the
// sibling: Jupiter cancels the losing leg server-side. We just observe
// the cancel event in history and update our DB.
//
// Trade row is written per fill so leaderboard / portfolio aggregation
// has a consistent source of truth.

import { Prisma, type PrismaClient, type TradeSource } from '@prisma/client';
import type { Server as IoServer } from 'socket.io';
import { WsServerEvents, getAssetById } from '@hunch-it/shared';
import { tryAutoPlaceExits } from './auto-exits.js';
import {
  reduceOrderState,
  type JupiterOrderV2,
  type OrderEvent,
} from './jupiter-history.js';

export type OrderForFill = Awaited<ReturnType<PrismaClient['order']['findMany']>>[number] & {
  user: {
    id: string;
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

/**
 * Pull execution numbers off the latest fill event. v2 carries these
 * on the event itself; the order-level outputAmount/inputUsed are the
 * cumulative totals across all fills, useful for partial fills.
 */
function extractFillAmounts(remote: JupiterOrderV2, lastFill: OrderEvent | undefined) {
  const eventOut = lastFill?.outputAmount ? Number(lastFill.outputAmount) : null;
  const eventIn = lastFill?.amount ? Number(lastFill.amount) : null;
  const cumulativeOut = remote.outputAmount ? Number(remote.outputAmount) : null;
  const cumulativeIn = remote.inputUsed ? Number(remote.inputUsed) : null;
  return {
    legInAmount: eventIn ?? cumulativeIn,
    legOutAmount: eventOut ?? cumulativeOut,
    cumulativeIn,
    cumulativeOut,
  };
}

export async function applyFill(
  prisma: PrismaClient,
  io: IoServer,
  order: OrderForFill,
  remote: JupiterOrderV2,
  lastFill?: OrderEvent,
): Promise<void> {
  const decimals = decimalsForAsset(order.position.ticker);
  const reduced = reduceOrderState(remote);
  const { legInAmount, legOutAmount, cumulativeIn, cumulativeOut } = extractFillAmounts(remote, lastFill);
  const executionPrice =
    legInAmount && legOutAmount && legOutAmount > 0 ? legInAmount / legOutAmount : null;
  const fillTimestampMs = lastFill?.timestamp ?? remote.triggeredAt ?? Date.now();

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: reduced.status === 'PARTIALLY_FILLED' ? 'PARTIALLY_FILLED' : 'FILLED',
      filledAmount: cumulativeOut,
      executionPrice,
      filledAt: new Date(fillTimestampMs),
    },
  });

  if (reduced.status === 'FILLED' && order.user && executionPrice) {
    const isBuy = order.kind === 'BUY_TRIGGER';
    const tokenAmt = isBuy
      ? (cumulativeOut ?? 0) / 10 ** decimals
      : (cumulativeIn ?? 0) / 10 ** decimals;
    const sizeUsd = isBuy
      ? (cumulativeIn ?? 0) / 10 ** 6
      : (cumulativeOut ?? 0) / 10 ** 6;
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

  if (order.kind === 'BUY_TRIGGER' && reduced.status === 'FILLED' && executionPrice) {
    const tokenAmount = cumulativeOut ? cumulativeOut / 10 ** decimals : 0;
    await prisma.position.update({
      where: { id: order.positionId },
      data: {
        state: 'ENTERING',
        entryPrice: executionPrice,
        tokenAmount,
        totalCost: tokenAmount * executionPrice,
      },
    });

    if (order.user?.delegationActive && order.user.privyWalletId && tokenAmount > 0) {
      const placed = await tryAutoPlaceExits({
        prisma,
        positionId: order.positionId,
        userId: order.userId,
        walletAddress: order.user.walletAddress,
        privyWalletId: order.user.privyWalletId,
        ticker: order.position.ticker,
        tokenAmount,
      }).catch((err) => {
        console.warn('[tracker] auto TP/SL placement threw', err);
        return 0;
      });
      if (placed > 0) {
        io.to(`user:${order.user.walletAddress}`).emit(WsServerEvents.PositionUpdated, {
          positionId: order.positionId,
          state: 'ACTIVE',
          action: 'auto-exits-placed',
          placedCount: placed,
        });
        console.log(
          `[tracker] auto-placed ${placed} exit leg(s) for position ${order.positionId.slice(0, 8)}…`,
        );
      }
    }
  }

  if (
    (order.kind === 'TAKE_PROFIT' || order.kind === 'STOP_LOSS') &&
    reduced.status === 'FILLED'
  ) {
    const tokenAmount = order.position.tokenAmount.toNumber();
    const realizedPnl = executionPrice
      ? (executionPrice - order.position.entryPrice.toNumber()) * tokenAmount
      : 0;
    await prisma.position.update({
      where: { id: order.positionId },
      data: {
        state: 'CLOSED',
        closedAt: new Date(fillTimestampMs),
        closedReason: order.kind === 'TAKE_PROFIT' ? 'TP_FILLED' : 'SL_FILLED',
        realizedPnl,
      },
    });

    // v2 native OCO: when one leg fills, Jupiter cancels the other on
    // their side. Our DB has two Order rows sharing the same
    // jupiterOrderId (the OCO id) — close the sibling row to match.
    if (order.jupiterOrderId) {
      await prisma.order.updateMany({
        where: {
          positionId: order.positionId,
          jupiterOrderId: order.jupiterOrderId,
          kind: order.kind === 'TAKE_PROFIT' ? 'STOP_LOSS' : 'TAKE_PROFIT',
          status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
        },
        data: { status: 'CANCELLED' },
      });
    }

    if (order.user) {
      io.to(`user:${order.user.walletAddress}`).emit(WsServerEvents.PositionUpdated, {
        positionId: order.positionId,
        state: 'CLOSED',
        action: 'oco-resolved',
        winningLeg: order.kind,
      });
    }
  }

  if (order.user) {
    io.to(`user:${order.user.walletAddress}`).emit(WsServerEvents.TradeFilled, {
      tradeId: order.id,
      ticker: order.position.ticker,
      side: order.side,
      executionPrice,
      tokenAmount: legOutAmount,
    });
  }
}
