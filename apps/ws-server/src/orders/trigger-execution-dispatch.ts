import type { Server as IoServer } from 'socket.io';
import {
  redactExecutionIdentifier,
  type TradeFilledPayload,
  type TriggerExecutionEvidence,
  type TriggerHitPayload,
  WsServerEvents,
} from '@hunch-it/shared';
import {
  tryExecuteDelegatedTriggerOrder,
  type DelegatedTriggerExecutionOutcome,
} from './delegated-execution.js';

const DELEGATED_RUNTIME_COOLDOWN_MS = 2 * 60_000;
const delegatedRuntimeCooldownUntil = new Map<string, number>();

export type DelegatedExecutor = (input: {
  userId: string;
  walletAddress: string;
  payload: TriggerHitPayload;
}) => Promise<DelegatedTriggerExecutionOutcome>;

export type TriggerExecutionDispatchResult =
  | { kind: 'delegatedSettled' }
  | { kind: 'delegatedFallback' }
  | { kind: 'delegatedSuppressed' }
  | { kind: 'delegatedFailure' };

export function clearDelegatedExecutionCooldownForTests(): void {
  delegatedRuntimeCooldownUntil.clear();
}

function emitTriggerHit(io: IoServer, walletAddress: string, payload: TriggerHitPayload): void {
  io.to(`user:${walletAddress}`).emit(WsServerEvents.TriggerHit, payload);
}

function emitTradeFilled(io: IoServer, walletAddress: string, payload: TradeFilledPayload): void {
  io.to(`user:${walletAddress}`).emit(WsServerEvents.TradeFilled, payload);
}

function sanitizeExecutionEvidence(
  evidence: TriggerExecutionEvidence,
): TriggerExecutionEvidence {
  return {
    ...evidence,
    orderId: redactExecutionIdentifier(evidence.orderId) ?? evidence.orderId,
    positionId: redactExecutionIdentifier(evidence.positionId) ?? evidence.positionId,
    jupiterRequestId: redactExecutionIdentifier(evidence.jupiterRequestId),
    txSignature: redactExecutionIdentifier(evidence.txSignature),
  };
}

export async function dispatchTriggeredOrderExecution(input: {
  io: IoServer;
  userId: string;
  walletAddress: string;
  payload: TriggerHitPayload;
  delegatedExecutor?: DelegatedExecutor;
  nowMs?: number;
  delegatedRuntimeCooldownMs?: number;
}): Promise<TriggerExecutionDispatchResult> {
  const now = input.nowMs ?? Date.now();
  const cooldownUntil = delegatedRuntimeCooldownUntil.get(input.payload.orderId) ?? 0;
  if (cooldownUntil > now) {
    emitTriggerHit(input.io, input.walletAddress, input.payload);
    return { kind: 'delegatedFallback' };
  }

  const executeDelegated = input.delegatedExecutor ?? tryExecuteDelegatedTriggerOrder;
  const outcome = await executeDelegated({
    userId: input.userId,
    walletAddress: input.walletAddress,
    payload: input.payload,
  });

  if (outcome.kind === 'settled') {
    console.info('[delegated-execution] settled', {
      orderId: outcome.orderId,
      positionId: outcome.positionId,
      ticker: outcome.ticker,
      orderKind: outcome.orderKind,
      executionEvidence: sanitizeExecutionEvidence(outcome.executionEvidence),
    });
    emitTradeFilled(input.io, input.walletAddress, {
      orderId: outcome.orderId,
      positionId: outcome.positionId,
      ticker: outcome.ticker,
      kind: outcome.orderKind,
      side: input.payload.side,
      executionMode: 'delegated',
      executionPrice: outcome.executionPrice,
      tokenAmount: outcome.tokenAmount,
      usdValue: outcome.usdValue,
      txSignature: outcome.signature,
    });
    return { kind: 'delegatedSettled' };
  }

  if (outcome.kind === 'alreadyHandled' || outcome.kind === 'alreadyExecuting') {
    return { kind: 'delegatedSuppressed' };
  }

  if (outcome.kind === 'notAvailable') {
    emitTriggerHit(input.io, input.walletAddress, input.payload);
    return { kind: 'delegatedFallback' };
  }

  if (outcome.kind === 'preBroadcastFailed') {
    if (outcome.shouldCooldown) {
      delegatedRuntimeCooldownUntil.set(
        input.payload.orderId,
        now + (input.delegatedRuntimeCooldownMs ?? DELEGATED_RUNTIME_COOLDOWN_MS),
      );
    }
    if (outcome.released) {
      emitTriggerHit(input.io, input.walletAddress, input.payload);
      return { kind: 'delegatedFallback' };
    }
    console.warn(
      `[delegated-execution] pre-broadcast failure without release order=${input.payload.orderId} reason=${outcome.reason}`,
    );
    return { kind: 'delegatedFailure' };
  }

  if (outcome.kind === 'broadcastUnknown') {
    console.error(
      `[delegated-execution] execute submitted but signature unknown order=${input.payload.orderId} reason=${outcome.reason} requestId=${outcome.requestId ?? 'unknown'}`,
    );
  } else {
    console.error(
      `[delegated-execution] broadcast/settlement failure order=${input.payload.orderId} reason=${outcome.reason} signature=${outcome.signature}`,
    );
  }
  return { kind: 'delegatedFailure' };
}
