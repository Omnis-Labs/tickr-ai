// Price-trigger monitor for Synthetic Orders.
//
// On Approve we persist the Order intent in our DB with no jupiterOrderId,
// and this monitor watches Pyth every ~30s. When a trigger condition fires,
// it first tries opt-in Delegated Execution. If that is unavailable or fails
// before broadcast, it emits `trigger:hit` to the user's room so the existing
// tap-to-execute fallback can run.
//
// Conditions:
//   TAKE_PROFIT  → fire when current ≥ triggerPriceUsd
//   STOP_LOSS    → fire when current ≤ triggerPriceUsd
//   BUY_TRIGGER  → fire when current is within 0.5% of triggerPriceUsd
//                  (we don't store direction; the tolerance band
//                   catches both limit-buy on dip and breakout-above)
//
// Without Delegated Execution, we don't change Order.status here — the order
// stays OPEN and the user's Execute click flips it to FILLED + writes a Trade
// row. With Delegated Execution, the monitor invokes the same PositionLifecycle
// settlement path and emits trade:filled after success.

import type { PrismaClient } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import {
  type TradeFilledPayload,
  type TriggerHitPayload,
  WsServerEvents,
} from '@hunch-it/shared';
import { getLatestPrices } from '../pyth/index.js';
import {
  tryExecuteDelegatedTriggerOrder,
  type DelegatedTriggerExecutionOutcome,
} from './delegated-execution.js';

export interface TriggerMonitorSummary {
  polledOrders: number;
  uniqueTickers: number;
  hits: number;
  delegatedSettled: number;
  delegatedFallbacks: number;
  delegatedSuppressed: number;
  delegatedFailures: number;
}

const BUY_TOLERANCE = 0.005; // 0.5%
const DELEGATED_RUNTIME_COOLDOWN_MS = 2 * 60_000;
const delegatedRuntimeCooldownUntil = new Map<string, number>();

type DelegatedExecutor = (input: {
  userId: string;
  walletAddress: string;
  payload: TriggerHitPayload;
}) => Promise<DelegatedTriggerExecutionOutcome>;
type PriceFetcher = typeof getLatestPrices;

export function clearDelegatedExecutionCooldownForTests(): void {
  delegatedRuntimeCooldownUntil.clear();
}

function shouldFire(order: {
  kind: string;
  triggerPriceUsd: { toNumber: () => number } | null;
}, currentPriceUsd: number): boolean {
  const trigger = order.triggerPriceUsd?.toNumber();
  if (trigger == null || !Number.isFinite(trigger) || trigger <= 0) return false;

  if (order.kind === 'TAKE_PROFIT') return currentPriceUsd >= trigger;
  if (order.kind === 'STOP_LOSS') return currentPriceUsd <= trigger;
  if (order.kind === 'BUY_TRIGGER') {
    return Math.abs(currentPriceUsd - trigger) / trigger < BUY_TOLERANCE;
  }
  return false;
}

function buildPayload(
  order: {
    id: string;
    positionId: string;
    kind: TriggerHitPayload['kind'];
    side: string;
    triggerPriceUsd: { toNumber: () => number } | null;
    sizeUsd: { toNumber: () => number };
    tokenAmount: { toNumber: () => number } | null;
    position: { ticker: string; mint: string };
  },
  currentPriceUsd: number,
): TriggerHitPayload | null {
  const trigger = order.triggerPriceUsd?.toNumber();
  if (!trigger) return null;
  return {
    orderId: order.id,
    positionId: order.positionId,
    ticker: order.position.ticker,
    mint: order.position.mint,
    kind: order.kind,
    side: order.side === 'BUY' ? 'BUY' : 'SELL',
    triggerPriceUsd: trigger,
    currentPriceUsd,
    sizeUsd: order.sizeUsd.toNumber(),
    tokenAmount: order.tokenAmount?.toNumber() ?? null,
  };
}

function emitTriggerHit(io: IoServer, walletAddress: string, payload: TriggerHitPayload): void {
  io.to(`user:${walletAddress}`).emit(WsServerEvents.TriggerHit, payload);
}

function emitTradeFilled(
  io: IoServer,
  walletAddress: string,
  payload: TradeFilledPayload,
): void {
  io.to(`user:${walletAddress}`).emit(WsServerEvents.TradeFilled, payload);
}

export async function runTriggerMonitor(
  prisma: PrismaClient,
  io: IoServer,
  deps: {
    delegatedExecutor?: DelegatedExecutor;
    priceFetcher?: PriceFetcher;
    nowMs?: () => number;
    delegatedRuntimeCooldownMs?: number;
  } = {},
): Promise<TriggerMonitorSummary> {
  const open = await prisma.order.findMany({
    where: {
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      triggerPriceUsd: { not: null },
      // Synthetic only. jupiterOrderId is vestigial schema and should
      // remain null for every live Order in the frozen architecture.
      jupiterOrderId: null,
    },
    include: { user: true, position: true },
  });
  const summary: TriggerMonitorSummary = {
    polledOrders: open.length,
    uniqueTickers: 0,
    hits: 0,
    delegatedSettled: 0,
    delegatedFallbacks: 0,
    delegatedSuppressed: 0,
    delegatedFailures: 0,
  };
  if (open.length === 0) return summary;

  // Group orders by asset id so we hit Pyth once per asset.
  const byTicker = new Map<string, typeof open>();
  for (const o of open) {
    const assetId = o.position.ticker;
    const list = byTicker.get(assetId) ?? [];
    list.push(o);
    byTicker.set(assetId, list);
  }
  summary.uniqueTickers = byTicker.size;

  const assetIds = Array.from(byTicker.keys());
  const prices = await (deps.priceFetcher ?? getLatestPrices)(assetIds);

  for (const [ticker, orders] of byTicker) {
    const snap = prices.get(ticker);
    if (!snap) continue;
    const currentPriceUsd = snap.price;

    for (const order of orders) {
      if (!order.user) continue;
      if (!shouldFire(order, currentPriceUsd)) continue;
      const payload = buildPayload(order, currentPriceUsd);
      if (!payload) continue;

      summary.hits++;
      const now = deps.nowMs?.() ?? Date.now();
      const cooldownUntil = delegatedRuntimeCooldownUntil.get(order.id) ?? 0;
      if (cooldownUntil > now) {
        summary.delegatedFallbacks++;
        emitTriggerHit(io, order.user.walletAddress, payload);
        continue;
      }

      const executeDelegated = deps.delegatedExecutor ?? tryExecuteDelegatedTriggerOrder;
      const outcome = await executeDelegated({
        userId: order.userId,
        walletAddress: order.user.walletAddress,
        payload,
      });

      if (outcome.kind === 'settled') {
        summary.delegatedSettled++;
        emitTradeFilled(io, order.user.walletAddress, {
          orderId: outcome.orderId,
          positionId: outcome.positionId,
          ticker: outcome.ticker,
          kind: outcome.orderKind,
          side: payload.side,
          executionMode: 'delegated',
          executionPrice: outcome.executionPrice,
          tokenAmount: outcome.tokenAmount,
          usdValue: outcome.usdValue,
          txSignature: outcome.signature,
        });
        continue;
      }

      if (outcome.kind === 'alreadyHandled' || outcome.kind === 'alreadyExecuting') {
        summary.delegatedSuppressed++;
        continue;
      }

      if (outcome.kind === 'notAvailable') {
        summary.delegatedFallbacks++;
        emitTriggerHit(io, order.user.walletAddress, payload);
        continue;
      }

      if (outcome.kind === 'preBroadcastFailed') {
        if (outcome.shouldCooldown) {
          delegatedRuntimeCooldownUntil.set(
            order.id,
            now + (deps.delegatedRuntimeCooldownMs ?? DELEGATED_RUNTIME_COOLDOWN_MS),
          );
        }
        if (outcome.released) {
          summary.delegatedFallbacks++;
          emitTriggerHit(io, order.user.walletAddress, payload);
        } else {
          summary.delegatedFailures++;
          console.warn(
            `[delegated-execution] pre-broadcast failure without release order=${order.id} reason=${outcome.reason}`,
          );
        }
        continue;
      }

      summary.delegatedFailures++;
      console.error(
        `[delegated-execution] broadcast/settlement failure order=${order.id} reason=${outcome.reason} signature=${outcome.signature}`,
      );
    }
  }

  return summary;
}
