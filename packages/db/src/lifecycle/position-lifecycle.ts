import { Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import { expireActiveProposals } from './proposal-expiration.js';

export type LifecycleStatus = 'success' | 'duplicate' | 'conflict';

export type LifecycleResult<T> =
  | { status: 'success'; data: T }
  | { status: 'duplicate'; orderId: string; positionId: string }
  | { status: 'conflict'; reason: string };

export class LifecycleInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleInvariantError';
  }
}

class PositionRaceRollback extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = 'PositionRaceRollback';
  }
}

type Tx = Prisma.TransactionClient;
type ExecutableOrderKind = 'BUY_TRIGGER' | 'TAKE_PROFIT' | 'STOP_LOSS';

function isExecutableOrderKind(kind: string): kind is ExecutableOrderKind {
  return kind === 'BUY_TRIGGER' || kind === 'TAKE_PROFIT' || kind === 'STOP_LOSS';
}

function executionStateFor(kind: ExecutableOrderKind): {
  before: 'BUY_PENDING' | 'ACTIVE';
  pending: 'ENTERING' | 'CLOSING';
} {
  return kind === 'BUY_TRIGGER'
    ? { before: 'BUY_PENDING', pending: 'ENTERING' }
    : { before: 'ACTIVE', pending: 'CLOSING' };
}

export function executedNotionalUsd(input: {
  executionPrice: number;
  tokenAmount: number;
}): number {
  return input.executionPrice * input.tokenAmount;
}

async function findOrderByTxSignature(client: Tx | typeof prisma, txSignature: string) {
  return client.order.findUnique({ where: { txSignature } });
}

async function buildDuplicateResult<T>(
  client: Tx | typeof prisma,
  orderId: string,
  txSignature: string,
): Promise<LifecycleResult<T>> {
  const existing = await findOrderByTxSignature(client, txSignature);
  if (existing && existing.id === orderId) {
    return {
      status: 'duplicate',
      orderId: existing.id,
      positionId: existing.positionId,
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
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes('txSignature');
  if (typeof target === 'string') return target.includes('txSignature');
  return false;
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
  if (!(input.tpPrice > 0) || !(input.slPrice > 0)) {
    return { status: 'conflict', reason: 'tp_sl_required_positive' };
  }
  if (!(input.triggerPriceUsd > 0) || !(input.entryPriceEstimate > 0)) {
    return { status: 'conflict', reason: 'invalid_prices' };
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await expireActiveProposals(tx, { userId: input.userId, now });

    const claimed = await tx.proposal.updateMany({
      where: {
        id: input.proposalId,
        userId: input.userId,
        status: 'ACTIVE',
        action: 'BUY',
        expiresAt: { gt: now },
      },
      data: { status: 'EXECUTED' },
    });
    if (claimed.count === 0) {
      const proposal = await tx.proposal.findUnique({
        where: { id: input.proposalId },
        select: { id: true, userId: true, status: true, action: true },
      });
      if (!proposal || proposal.userId !== input.userId) {
        return { status: 'conflict', reason: 'proposal_not_found' };
      }
      if (proposal.action !== 'BUY') {
        return {
          status: 'conflict',
          reason: `proposal_action_${proposal.action.toLowerCase()}`,
        };
      }
      return {
        status: 'conflict',
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

    await tx.proposal.update({
      where: { id: input.proposalId },
      data: { positionId: position.id },
    });

    return {
      status: 'success',
      data: { orderId: order.id, positionId: position.id },
    };
  });
}

export async function cancelPendingBuy(input: { userId: string; orderId: string }): Promise<
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
        return { status: 'conflict', reason: 'order_not_found' };
      }
      return {
        status: 'conflict',
        reason: `order_${existing.kind.toLowerCase()}_${existing.status.toLowerCase()}`,
      };
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { positionId: true },
    });

    const closedPos = await tx.position.updateMany({
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
    if (closedPos.count === 0) {
      throw new LifecycleInvariantError(
        `cancelPendingBuy: BUY_TRIGGER ${input.orderId} cancelled but parent ` +
          `Position ${order.positionId} was not BUY_PENDING`,
      );
    }

    return {
      status: 'success',
      data: {
        orderId: input.orderId,
        orderStatus: 'CANCELLED',
        positionId: order.positionId,
        positionStatus: 'CLOSED',
      },
    };
  });
}

export async function claimOrderExecution(input: {
  userId: string;
  orderId: string;
}): Promise<
  LifecycleResult<{
    orderId: string;
    positionId: string;
    orderStatus: 'PENDING';
    positionStatus: 'ENTERING' | 'CLOSING';
  }>
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          userId: true,
          positionId: true,
          kind: true,
          status: true,
          triggerPriceUsd: true,
          jupiterOrderId: true,
          position: { select: { state: true } },
        },
      });
      if (!order || order.userId !== input.userId) {
        return { status: 'conflict', reason: 'order_not_found' };
      }
      if (!isExecutableOrderKind(order.kind)) {
        return {
          status: 'conflict',
          reason: `order_kind_${order.kind.toLowerCase()}`,
        };
      }
      if (order.jupiterOrderId != null || order.triggerPriceUsd == null) {
        return { status: 'conflict', reason: 'order_not_synthetic_trigger' };
      }
      if (order.status !== 'OPEN') {
        return {
          status: 'conflict',
          reason: `order_${order.status.toLowerCase()}`,
        };
      }

      const states = executionStateFor(order.kind);
      if (order.position.state !== states.before) {
        return {
          status: 'conflict',
          reason: `position_state_${order.position.state.toLowerCase()}`,
        };
      }

      const claimedOrder = await tx.order.updateMany({
        where: {
          id: input.orderId,
          userId: input.userId,
          status: 'OPEN',
        },
        data: { status: 'PENDING' },
      });
      if (claimedOrder.count === 0) {
        const cur = await tx.order.findUnique({
          where: { id: input.orderId },
          select: { status: true },
        });
        return {
          status: 'conflict',
          reason: cur ? `order_${cur.status.toLowerCase()}` : 'order_not_found',
        };
      }

      const claimedPosition = await tx.position.updateMany({
        where: {
          id: order.positionId,
          userId: input.userId,
          state: states.before,
        },
        data: { state: states.pending },
      });
      if (claimedPosition.count === 0) {
        const cur = await tx.position.findUnique({
          where: { id: order.positionId },
          select: { state: true },
        });
        throw new PositionRaceRollback(
          cur ? `position_state_${cur.state.toLowerCase()}` : 'position_not_found',
        );
      }

      return {
        status: 'success',
        data: {
          orderId: input.orderId,
          positionId: order.positionId,
          orderStatus: 'PENDING',
          positionStatus: states.pending,
        },
      };
    });
  } catch (err) {
    if (err instanceof PositionRaceRollback) {
      return { status: 'conflict', reason: err.reason };
    }
    throw err;
  }
}

export async function releaseOrderExecutionClaim(input: {
  userId: string;
  orderId: string;
}): Promise<
  LifecycleResult<{
    orderId: string;
    positionId: string;
    orderStatus: 'OPEN';
    positionStatus: 'BUY_PENDING' | 'ACTIVE';
  }>
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          userId: true,
          positionId: true,
          kind: true,
          status: true,
          txSignature: true,
          filledAt: true,
          position: { select: { state: true } },
        },
      });
      if (!order || order.userId !== input.userId) {
        return { status: 'conflict', reason: 'order_not_found' };
      }
      if (!isExecutableOrderKind(order.kind)) {
        return {
          status: 'conflict',
          reason: `order_kind_${order.kind.toLowerCase()}`,
        };
      }
      if (order.status !== 'PENDING') {
        return {
          status: 'conflict',
          reason: `order_${order.status.toLowerCase()}`,
        };
      }
      if (order.txSignature != null || order.filledAt != null) {
        return { status: 'conflict', reason: 'order_fill_in_progress' };
      }

      const states = executionStateFor(order.kind);
      if (order.position.state !== states.pending) {
        return {
          status: 'conflict',
          reason: `position_state_${order.position.state.toLowerCase()}`,
        };
      }

      const releasedOrder = await tx.order.updateMany({
        where: {
          id: input.orderId,
          userId: input.userId,
          status: 'PENDING',
          txSignature: null,
          filledAt: null,
        },
        data: { status: 'OPEN' },
      });
      if (releasedOrder.count === 0) {
        throw new PositionRaceRollback('order_not_pending');
      }

      const releasedPosition = await tx.position.updateMany({
        where: {
          id: order.positionId,
          userId: input.userId,
          state: states.pending,
        },
        data: { state: states.before },
      });
      if (releasedPosition.count === 0) {
        throw new PositionRaceRollback(`position_not_${states.pending.toLowerCase()}`);
      }

      return {
        status: 'success',
        data: {
          orderId: input.orderId,
          positionId: order.positionId,
          orderStatus: 'OPEN',
          positionStatus: states.before,
        },
      };
    });
  } catch (err) {
    if (err instanceof PositionRaceRollback) {
      return { status: 'conflict', reason: err.reason };
    }
    throw err;
  }
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
          status: { in: ['OPEN', 'PENDING'] },
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
        return buildDuplicateResult(tx, input.orderId, input.txSignature);
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

      const positionClaimed = await tx.position.updateMany({
        where: {
          id: order.position.id,
          userId: input.userId,
          state: { in: ['BUY_PENDING', 'ENTERING'] },
        },
        data: {
          state: 'ACTIVE',
          entryPrice: input.executionPrice,
          tokenAmount: input.tokenAmount,
          totalCost,
        },
      });
      if (positionClaimed.count === 0) {
        throw new PositionRaceRollback('position_not_buy_pending');
      }

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
    if (err instanceof PositionRaceRollback) {
      return { status: 'conflict', reason: err.reason };
    }
    if (isUniqueTxSignatureViolation(err)) {
      return buildDuplicateResult(prisma, input.orderId, input.txSignature);
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
          status: { in: ['OPEN', 'PENDING'] },
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
        return buildDuplicateResult(tx, input.orderId, input.txSignature);
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        include: {
          position: { select: { id: true, ticker: true, entryPrice: true } },
        },
      });

      const source: 'TP_FILL' | 'SL_FILL' = order.kind === 'TAKE_PROFIT' ? 'TP_FILL' : 'SL_FILL';
      const closedReason = order.kind === 'TAKE_PROFIT' ? 'TP_FILLED' : 'SL_FILLED';
      const siblingKind = order.kind === 'TAKE_PROFIT' ? 'STOP_LOSS' : 'TAKE_PROFIT';

      const realizedPnl =
        (input.executionPrice - order.position.entryPrice.toNumber()) * input.tokenAmount;

      const positionClaimed = await tx.position.updateMany({
        where: {
          id: order.position.id,
          userId: input.userId,
          state: { in: ['ACTIVE', 'CLOSING'] },
        },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          closedReason,
          realizedPnl: new Prisma.Decimal(realizedPnl),
        },
      });
      if (positionClaimed.count === 0) {
        throw new PositionRaceRollback('position_not_active');
      }

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
          actualSizeUsd: executedNotionalUsd(input),
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
    if (err instanceof PositionRaceRollback) {
      return { status: 'conflict', reason: err.reason };
    }
    if (isUniqueTxSignatureViolation(err)) {
      return buildDuplicateResult(prisma, input.orderId, input.txSignature);
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
          return {
            status: 'duplicate',
            orderId: existingByTx.id,
            positionId: input.positionId,
          };
        }
        return { status: 'conflict', reason: 'tx_signature_already_used' };
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
        const dup = await findOrderByTxSignature(tx, input.txSignature);
        if (
          dup &&
          dup.userId === input.userId &&
          dup.positionId === input.positionId &&
          dup.kind === 'CLOSE_SWAP'
        ) {
          return {
            status: 'duplicate',
            orderId: dup.id,
            positionId: input.positionId,
          };
        }
        const pos = await tx.position.findUnique({
          where: { id: input.positionId },
          select: { id: true, userId: true, state: true },
        });
        if (!pos || pos.userId !== input.userId) {
          return { status: 'conflict', reason: 'position_not_found' };
        }
        return {
          status: 'conflict',
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
          actualSizeUsd: executedNotionalUsd(input),
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
      return { status: 'conflict', reason: 'tx_signature_already_used' };
    }
    throw err;
  }
}

export async function replaceProtectionOrders(input: {
  userId: string;
  positionId: string;
  tpPrice?: number;
  slPrice?: number;
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
  if (input.tpPrice != null && !(input.tpPrice > 0)) {
    return { status: 'conflict', reason: 'invalid_tp_price' };
  }
  if (input.slPrice != null && !(input.slPrice > 0)) {
    return { status: 'conflict', reason: 'invalid_sl_price' };
  }

  return prisma.$transaction(async (tx) => {
    const position = await tx.position.findUnique({
      where: { id: input.positionId },
      select: {
        id: true,
        userId: true,
        state: true,
        tokenAmount: true,
      },
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
    const tokenAmount = position.tokenAmount?.toNumber() ?? 0;
    if (!(tokenAmount > 0)) {
      return { status: 'conflict', reason: 'position_token_amount_invalid' };
    }

    const lockedActive = await tx.position.updateMany({
      where: { id: input.positionId, state: 'ACTIVE' },
      data: { updatedAt: new Date() },
    });
    if (lockedActive.count === 0) {
      return { status: 'conflict', reason: 'position_not_active' };
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
          sizeUsd: input.tpPrice * tokenAmount,
          tokenAmount,
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
          sizeUsd: input.slPrice * tokenAmount,
          tokenAmount,
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
      status: 'success',
      data: {
        positionId: input.positionId,
        cancelledOrderIds: stale.map((s) => s.id),
        takeProfitOrderId: tpOrderId,
        stopLossOrderId: slOrderId,
      },
    };
  });
}
