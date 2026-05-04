import { Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export type LifecycleStatus = 'success' | 'duplicate' | 'conflict';

export type LifecycleResult<T> =
  | { status: 'success'; data: T }
  | { status: 'duplicate'; data: T }
  | { status: 'conflict'; reason: string; data?: T };

export class LifecycleInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleInvariantError';
  }
}

type Tx = Prisma.TransactionClient;

async function findOrderByTxSignature(tx: Tx | typeof prisma, txSignature: string) {
  return tx.order.findUnique({ where: { txSignature } });
}

export async function acceptBuyProposal(input: {
  userId: string;
  proposalId: string;
  ticker: string;
  mint: string;
  sizeUsd: number;
  triggerPriceUsd: number;
  tpPrice: number;
  slPrice: number;
  entryPriceEstimate: number;
}): Promise<
  LifecycleResult<{
    orderId: string;
    positionId: string;
  }>
> {
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.proposal.findUnique({
      where: { id: input.proposalId },
      select: { id: true, userId: true, status: true },
    });
    if (!proposal || proposal.userId !== input.userId) {
      return {
        status: 'conflict' as const,
        reason: 'proposal_not_found',
      };
    }
    if (proposal.status !== 'ACTIVE') {
      return {
        status: 'conflict' as const,
        reason: `proposal_status_${proposal.status.toLowerCase()}`,
      };
    }

    const position = await tx.position.create({
      data: {
        userId: input.userId,
        ticker: input.ticker,
        mint: input.mint,
        tokenAmount: 0,
        entryPrice: input.entryPriceEstimate,
        totalCost: 0,
        currentTpPrice: input.tpPrice,
        currentSlPrice: input.slPrice,
        state: 'BUY_PENDING',
        firstEntryAt: new Date(),
      },
    });

    const order = await tx.order.create({
      data: {
        userId: input.userId,
        positionId: position.id,
        kind: 'BUY_TRIGGER',
        side: 'BUY',
        triggerPriceUsd: input.triggerPriceUsd,
        sizeUsd: input.sizeUsd,
        status: 'OPEN',
        jupiterOrderId: null,
      },
    });

    await tx.proposal.updateMany({
      where: { id: input.proposalId, userId: input.userId, status: 'ACTIVE' },
      data: { status: 'EXECUTED' },
    });

    return {
      status: 'success' as const,
      data: { orderId: order.id, positionId: position.id },
    };
  });
}

export async function cancelPendingBuy(input: {
  userId: string;
  orderId: string;
}): Promise<
  LifecycleResult<{
    orderId: string;
    orderStatus: 'CANCELLED';
    positionId: string;
    positionStatus: 'CLOSED';
  }>
> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: {
        id: input.orderId,
        userId: input.userId,
        kind: 'BUY_TRIGGER',
        status: 'OPEN',
      },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count === 0) {
      const existing = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, userId: true, status: true, kind: true },
      });
      if (!existing || existing.userId !== input.userId) {
        return { status: 'conflict' as const, reason: 'order_not_found' };
      }
      return {
        status: 'conflict' as const,
        reason: `order_${existing.kind.toLowerCase()}_${existing.status.toLowerCase()}`,
      };
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { positionId: true },
    });

    await tx.position.updateMany({
      where: {
        id: order.positionId,
        userId: input.userId,
        state: 'BUY_PENDING',
      },
      data: {
        state: 'CLOSED',
        closedAt: new Date(),
        closedReason: 'BUY_CANCELLED',
        realizedPnl: 0,
      },
    });

    return {
      status: 'success' as const,
      data: {
        orderId: input.orderId,
        orderStatus: 'CANCELLED',
        positionId: order.positionId,
        positionStatus: 'CLOSED',
      },
    };
  });
}

export async function confirmBuyFill(input: {
  userId: string;
  orderId: string;
  txSignature: string;
  executionPrice: number;
  tokenAmount: number;
}): Promise<
  LifecycleResult<{
    orderId: string;
    positionId: string;
    positionStatus: 'ACTIVE';
    tradeId: string;
    takeProfitOrderId: string;
    stopLossOrderId: string;
  }>
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id: input.orderId,
          userId: input.userId,
          kind: 'BUY_TRIGGER',
          status: 'OPEN',
        },
        data: {
          status: 'FILLED',
          txSignature: input.txSignature,
          executionPrice: input.executionPrice,
          filledAmount: input.tokenAmount,
          filledAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        return resolveDuplicateOrConflict(tx, input.orderId, input.txSignature);
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        include: {
          position: {
            select: {
              id: true,
              ticker: true,
              currentTpPrice: true,
              currentSlPrice: true,
            },
          },
        },
      });

      const tp = order.position.currentTpPrice?.toNumber() ?? null;
      const sl = order.position.currentSlPrice?.toNumber() ?? null;
      if (tp == null || tp <= 0 || sl == null || sl <= 0) {
        throw new LifecycleInvariantError(
          `confirmBuyFill: position ${order.position.id} missing TP/SL seed prices`,
        );
      }

      const totalCost = input.executionPrice * input.tokenAmount;

      await tx.position.update({
        where: { id: order.position.id },
        data: {
          state: 'ACTIVE',
          entryPrice: input.executionPrice,
          tokenAmount: input.tokenAmount,
          totalCost,
        },
      });

      const trade = await tx.trade.create({
        data: {
          userId: input.userId,
          positionId: order.position.id,
          ticker: order.position.ticker,
          side: 'BUY',
          source: 'BUY_APPROVAL',
          actualSizeUsd: order.sizeUsd,
          actualTriggerPrice: order.triggerPriceUsd,
          executionPrice: input.executionPrice,
          filledAmount: input.tokenAmount,
        },
      });

      const tpOrder = await tx.order.create({
        data: {
          userId: input.userId,
          positionId: order.position.id,
          kind: 'TAKE_PROFIT',
          side: 'SELL',
          triggerPriceUsd: tp,
          sizeUsd: tp * input.tokenAmount,
          tokenAmount: input.tokenAmount,
          status: 'OPEN',
          jupiterOrderId: null,
        },
      });
      const slOrder = await tx.order.create({
        data: {
          userId: input.userId,
          positionId: order.position.id,
          kind: 'STOP_LOSS',
          side: 'SELL',
          triggerPriceUsd: sl,
          sizeUsd: sl * input.tokenAmount,
          tokenAmount: input.tokenAmount,
          status: 'OPEN',
          jupiterOrderId: null,
        },
      });

      return {
        status: 'success' as const,
        data: {
          orderId: input.orderId,
          positionId: order.position.id,
          positionStatus: 'ACTIVE' as const,
          tradeId: trade.id,
          takeProfitOrderId: tpOrder.id,
          stopLossOrderId: slOrder.id,
        },
      };
    });
  } catch (err) {
    if (isUniqueTxSignatureViolation(err)) {
      return resolveDuplicateOrConflict(prisma, input.orderId, input.txSignature);
    }
    throw err;
  }
}

export async function confirmExitFill(input: {
  userId: string;
  orderId: string;
  txSignature: string;
  executionPrice: number;
  tokenAmount: number;
}): Promise<
  LifecycleResult<{
    orderId: string;
    positionId: string;
    positionStatus: 'CLOSED';
    tradeId: string;
    siblingOrderId: string | null;
    siblingOrderStatus: 'CANCELLED' | null;
    source: 'TP_FILL' | 'SL_FILL';
  }>
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id: input.orderId,
          userId: input.userId,
          kind: { in: ['TAKE_PROFIT', 'STOP_LOSS'] },
          status: 'OPEN',
        },
        data: {
          status: 'FILLED',
          txSignature: input.txSignature,
          executionPrice: input.executionPrice,
          filledAmount: input.tokenAmount,
          filledAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        return resolveDuplicateOrConflict(tx, input.orderId, input.txSignature);
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        include: {
          position: { select: { id: true, ticker: true, entryPrice: true } },
        },
      });

      const source: 'TP_FILL' | 'SL_FILL' =
        order.kind === 'TAKE_PROFIT' ? 'TP_FILL' : 'SL_FILL';
      const closedReason = order.kind === 'TAKE_PROFIT' ? 'TP_FILLED' : 'SL_FILLED';
      const siblingKind = order.kind === 'TAKE_PROFIT' ? 'STOP_LOSS' : 'TAKE_PROFIT';

      const realizedPnl =
        (input.executionPrice - order.position.entryPrice.toNumber()) *
        input.tokenAmount;

      await tx.position.update({
        where: { id: order.position.id },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          closedReason,
          realizedPnl: new Prisma.Decimal(realizedPnl),
        },
      });

      const sibling = await tx.order.findFirst({
        where: {
          positionId: order.position.id,
          kind: siblingKind,
          status: 'OPEN',
        },
        select: { id: true },
      });
      if (sibling) {
        await tx.order.updateMany({
          where: { id: sibling.id, status: 'OPEN' },
          data: { status: 'CANCELLED' },
        });
      }

      const trade = await tx.trade.create({
        data: {
          userId: input.userId,
          positionId: order.position.id,
          ticker: order.position.ticker,
          side: 'SELL',
          source,
          actualSizeUsd: order.sizeUsd,
          actualTriggerPrice: order.triggerPriceUsd,
          executionPrice: input.executionPrice,
          filledAmount: input.tokenAmount,
          realizedPnl: new Prisma.Decimal(realizedPnl),
        },
      });

      return {
        status: 'success' as const,
        data: {
          orderId: input.orderId,
          positionId: order.position.id,
          positionStatus: 'CLOSED' as const,
          tradeId: trade.id,
          siblingOrderId: sibling?.id ?? null,
          siblingOrderStatus: sibling ? 'CANCELLED' : null,
          source,
        },
      };
    });
  } catch (err) {
    if (isUniqueTxSignatureViolation(err)) {
      return resolveDuplicateOrConflict(prisma, input.orderId, input.txSignature);
    }
    throw err;
  }
}

export async function userCloseActive(input: {
  userId: string;
  positionId: string;
  txSignature: string;
  executionPrice: number;
  tokenAmount: number;
}): Promise<
  LifecycleResult<{
    closeOrderId: string;
    positionId: string;
    positionStatus: 'CLOSED';
    tradeId: string;
    cancelledExitOrderIds: string[];
  }>
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existingByTx = await findOrderByTxSignature(tx, input.txSignature);
      if (existingByTx) {
        if (
          existingByTx.userId === input.userId &&
          existingByTx.positionId === input.positionId &&
          existingByTx.kind === 'CLOSE_SWAP'
        ) {
          const pos = await tx.position.findUnique({
            where: { id: input.positionId },
            select: { state: true },
          });
          if (pos?.state === 'CLOSED') {
            return {
              status: 'duplicate' as const,
              data: {
                closeOrderId: existingByTx.id,
                positionId: input.positionId,
                positionStatus: 'CLOSED' as const,
                tradeId: '',
                cancelledExitOrderIds: [],
              },
            };
          }
        }
        return {
          status: 'conflict' as const,
          reason: 'tx_signature_already_used',
        };
      }

      const claimed = await tx.position.updateMany({
        where: {
          id: input.positionId,
          userId: input.userId,
          state: 'ACTIVE',
        },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          closedReason: 'USER_CLOSE',
        },
      });
      if (claimed.count === 0) {
        const pos = await tx.position.findUnique({
          where: { id: input.positionId },
          select: { id: true, userId: true, state: true },
        });
        if (!pos || pos.userId !== input.userId) {
          return { status: 'conflict' as const, reason: 'position_not_found' };
        }
        return {
          status: 'conflict' as const,
          reason: `position_state_${pos.state.toLowerCase()}`,
        };
      }

      const position = await tx.position.findUniqueOrThrow({
        where: { id: input.positionId },
        select: { ticker: true, entryPrice: true },
      });

      const realizedPnl =
        (input.executionPrice - position.entryPrice.toNumber()) * input.tokenAmount;
      await tx.position.update({
        where: { id: input.positionId },
        data: { realizedPnl: new Prisma.Decimal(realizedPnl) },
      });

      const openExits = await tx.order.findMany({
        where: {
          positionId: input.positionId,
          kind: { in: ['TAKE_PROFIT', 'STOP_LOSS'] },
          status: 'OPEN',
        },
        select: { id: true },
      });
      if (openExits.length > 0) {
        await tx.order.updateMany({
          where: {
            id: { in: openExits.map((o) => o.id) },
            status: 'OPEN',
          },
          data: { status: 'CANCELLED' },
        });
      }

      const closeOrder = await tx.order.create({
        data: {
          userId: input.userId,
          positionId: input.positionId,
          kind: 'CLOSE_SWAP',
          side: 'SELL',
          triggerPriceUsd: null,
          sizeUsd: input.executionPrice * input.tokenAmount,
          tokenAmount: input.tokenAmount,
          status: 'FILLED',
          jupiterOrderId: null,
          txSignature: input.txSignature,
          executionPrice: input.executionPrice,
          filledAmount: input.tokenAmount,
          filledAt: new Date(),
        },
      });

      const trade = await tx.trade.create({
        data: {
          userId: input.userId,
          positionId: input.positionId,
          ticker: position.ticker,
          side: 'SELL',
          source: 'USER_CLOSE',
          actualSizeUsd: input.executionPrice * input.tokenAmount,
          executionPrice: input.executionPrice,
          filledAmount: input.tokenAmount,
          realizedPnl: new Prisma.Decimal(realizedPnl),
        },
      });

      return {
        status: 'success' as const,
        data: {
          closeOrderId: closeOrder.id,
          positionId: input.positionId,
          positionStatus: 'CLOSED' as const,
          tradeId: trade.id,
          cancelledExitOrderIds: openExits.map((o) => o.id),
        },
      };
    });
  } catch (err) {
    if (isUniqueTxSignatureViolation(err)) {
      return {
        status: 'conflict' as const,
        reason: 'tx_signature_already_used',
      };
    }
    throw err;
  }
}

export async function replaceProtectionOrders(input: {
  userId: string;
  positionId: string;
  tpPrice?: number;
  slPrice?: number;
  tokenAmount: number;
}): Promise<
  LifecycleResult<{
    positionId: string;
    cancelledOrderIds: string[];
    takeProfitOrderId?: string;
    stopLossOrderId?: string;
  }>
> {
  if (input.tpPrice == null && input.slPrice == null) {
    return { status: 'conflict', reason: 'no_prices_provided' };
  }
  return prisma.$transaction(async (tx) => {
    const position = await tx.position.findUnique({
      where: { id: input.positionId },
      select: { id: true, userId: true, state: true },
    });
    if (!position || position.userId !== input.userId) {
      return { status: 'conflict', reason: 'position_not_found' };
    }
    if (position.state !== 'ACTIVE') {
      return {
        status: 'conflict',
        reason: `position_state_${position.state.toLowerCase()}`,
      };
    }

    const kindsToReplace: Array<'TAKE_PROFIT' | 'STOP_LOSS'> = [];
    if (input.tpPrice != null) kindsToReplace.push('TAKE_PROFIT');
    if (input.slPrice != null) kindsToReplace.push('STOP_LOSS');

    const stale = await tx.order.findMany({
      where: {
        positionId: input.positionId,
        kind: { in: kindsToReplace },
        status: 'OPEN',
      },
      select: { id: true },
    });
    if (stale.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: stale.map((s) => s.id) }, status: 'OPEN' },
        data: { status: 'CANCELLED' },
      });
    }

    let tpOrderId: string | undefined;
    if (input.tpPrice != null) {
      const tpOrder = await tx.order.create({
        data: {
          userId: input.userId,
          positionId: input.positionId,
          kind: 'TAKE_PROFIT',
          side: 'SELL',
          triggerPriceUsd: input.tpPrice,
          sizeUsd: input.tpPrice * input.tokenAmount,
          tokenAmount: input.tokenAmount,
          status: 'OPEN',
          jupiterOrderId: null,
        },
      });
      tpOrderId = tpOrder.id;
      await tx.position.update({
        where: { id: input.positionId },
        data: { currentTpPrice: input.tpPrice },
      });
    }

    let slOrderId: string | undefined;
    if (input.slPrice != null) {
      const slOrder = await tx.order.create({
        data: {
          userId: input.userId,
          positionId: input.positionId,
          kind: 'STOP_LOSS',
          side: 'SELL',
          triggerPriceUsd: input.slPrice,
          sizeUsd: input.slPrice * input.tokenAmount,
          tokenAmount: input.tokenAmount,
          status: 'OPEN',
          jupiterOrderId: null,
        },
      });
      slOrderId = slOrder.id;
      await tx.position.update({
        where: { id: input.positionId },
        data: { currentSlPrice: input.slPrice },
      });
    }

    return {
      status: 'success' as const,
      data: {
        positionId: input.positionId,
        cancelledOrderIds: stale.map((s) => s.id),
        takeProfitOrderId: tpOrderId,
        stopLossOrderId: slOrderId,
      },
    };
  });
}

async function resolveDuplicateOrConflict<T>(
  client: Tx | typeof prisma,
  orderId: string,
  txSignature: string,
): Promise<LifecycleResult<T>> {
  const existing = await findOrderByTxSignature(client, txSignature);
  if (existing && existing.id === orderId) {
    return {
      status: 'duplicate',
      data: { orderId, positionId: existing.positionId } as unknown as T,
    };
  }
  if (existing) {
    return {
      status: 'conflict',
      reason: 'tx_signature_belongs_to_another_order',
    };
  }
  const cur = await client.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  return {
    status: 'conflict',
    reason: cur ? `order_${cur.status.toLowerCase()}` : 'order_not_found',
  };
}

function isUniqueTxSignatureViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes('txSignature')
  );
}
