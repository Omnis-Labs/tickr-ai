// Fill reconciliation — when Jupiter History reports an order moved to
// FILLED / PARTIALLY_FILLED, mirror the fill into our Order + Position rows
// and emit the matching socket event. Includes the OCO sibling cancel branch
// for TP / SL pairs.

import type { PrismaClient } from '@prisma/client';
import type { Server as IoServer } from 'socket.io';
import { WsServerEvents } from '@hunch-it/shared';
import { tryDelegatedCancel } from './oco.js';
import type { JupiterHistoryEntry } from './jupiter-history.js';

// Prisma's Decimal columns return Decimal objects on read; the fill math
// here just needs plain numbers, so the consumer is responsible for
// .toNumber() before passing in.
import type { Prisma } from '@prisma/client';

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

export async function applyFill(
  prisma: PrismaClient,
  io: IoServer,
  order: OrderForFill,
  remote: JupiterHistoryEntry,
): Promise<void> {
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

  if (order.kind === 'BUY_TRIGGER' && remote.status === 'FILLED' && executionPrice) {
    // BUY filled → Position transitions to ENTERING. The user places TP/SL
    // next via Position Detail.
    const tokenAmount = outAmount ? outAmount / 10 ** 8 : 0;
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
    // TP / SL filled → mark Position CLOSED with realized PnL.
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
