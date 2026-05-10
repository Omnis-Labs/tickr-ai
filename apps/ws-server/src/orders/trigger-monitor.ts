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
import { type TriggerHitPayload } from '@hunch-it/shared';
import { getLatestPrices } from '../pyth/index.js';
import {
  clearDelegatedExecutionCooldownForTests,
  dispatchTriggeredOrderExecution,
  type DelegatedExecutor,
} from './trigger-execution-dispatch.js';
export { clearDelegatedExecutionCooldownForTests };

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
type PriceFetcher = typeof getLatestPrices;

function shouldFire(
  order: {
    kind: string;
    triggerPriceUsd: { toNumber: () => number } | null;
  },
  currentPriceUsd: number,
): boolean {
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
      const dispatch = await dispatchTriggeredOrderExecution({
        io,
        userId: order.userId,
        walletAddress: order.user.walletAddress,
        payload,
        delegatedExecutor: deps.delegatedExecutor,
        nowMs: deps.nowMs?.() ?? Date.now(),
        delegatedRuntimeCooldownMs: deps.delegatedRuntimeCooldownMs,
      });

      if (dispatch.kind === 'delegatedSettled') summary.delegatedSettled++;
      else if (dispatch.kind === 'delegatedFallback') summary.delegatedFallbacks++;
      else if (dispatch.kind === 'delegatedSuppressed') summary.delegatedSuppressed++;
      else summary.delegatedFailures++;
    }
  }

  return summary;
}
