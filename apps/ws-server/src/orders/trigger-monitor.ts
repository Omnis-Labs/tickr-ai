// Price-trigger monitor for Synthetic Orders.
//
// On Approve we persist the Order intent in our DB with no jupiterOrderId.
// This monitor watches Pyth as a cheap wake-up band, then asks Jupiter Ultra
// for the executable price. Only an executable quote that satisfies the
// Order's actual trigger condition becomes actionable.
//
// Conditions:
//   BUY_TRIGGER  → wake when Pyth ≤ trigger * 1.005; trigger when Ultra BUY ≤ trigger
//   TAKE_PROFIT  → wake when Pyth ≥ trigger * 0.995; trigger when Ultra SELL ≥ trigger
//   STOP_LOSS    → wake when Pyth ≤ trigger * 1.005; trigger when Ultra SELL ≤ trigger
//
// Without Delegated Execution, we don't change Order.status here — the order
// stays OPEN and the user's Execute click flips it to FILLED + writes a Trade
// row. With Delegated Execution, the monitor invokes the same PositionLifecycle
// settlement path and emits trade:filled after success.

import type { PrismaClient } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import {
  pythWakeUpBandHit,
  type ExecutableTriggerDecision,
  type TriggerExecutionEvidence,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import { getLatestPrices } from '../pyth/index.js';
import {
  quoteExecutableTrigger as defaultQuoteExecutableTrigger,
  type QuoteExecutableTrigger,
} from './executable-trigger-quote.js';
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
  quoteWaiting: number;
  quoteFailures: number;
  delegatedSettled: number;
  delegatedFallbacks: number;
  delegatedSuppressed: number;
  delegatedFailures: number;
}

type PriceFetcher = typeof getLatestPrices;

function shouldWakeUp(
  order: {
    kind: string;
    triggerPriceUsd: { toNumber: () => number } | null;
  },
  currentPriceUsd: number,
): boolean {
  if (
    order.kind !== 'BUY_TRIGGER' &&
    order.kind !== 'TAKE_PROFIT' &&
    order.kind !== 'STOP_LOSS'
  ) {
    return false;
  }
  return pythWakeUpBandHit({
    kind: order.kind,
    triggerPriceUsd: order.triggerPriceUsd?.toNumber(),
    currentPriceUsd,
  });
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

function withExecutableQuote(
  payload: TriggerHitPayload,
  evidence: TriggerExecutionEvidence,
): TriggerHitPayload {
  return {
    ...payload,
    executablePriceUsd: evidence.executionPrice,
    executableTokenAmount: evidence.tokenAmount,
    executableUsdValue: evidence.usdValue,
    executablePremiumVsCurrentPricePct: evidence.premiumVsCurrentPricePct,
    executablePremiumVsTriggerPricePct: evidence.premiumVsTriggerPricePct,
  };
}

export async function runTriggerMonitor(
  prisma: PrismaClient,
  io: IoServer,
  deps: {
    delegatedExecutor?: DelegatedExecutor;
    priceFetcher?: PriceFetcher;
    quoteExecutableTrigger?: QuoteExecutableTrigger;
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
    quoteWaiting: 0,
    quoteFailures: 0,
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
  const quoteExecutableTrigger = deps.quoteExecutableTrigger ?? defaultQuoteExecutableTrigger;

  for (const [ticker, orders] of byTicker) {
    const snap = prices.get(ticker);
    if (!snap) continue;
    const currentPriceUsd = snap.price;

    for (const order of orders) {
      if (!order.user) continue;
      if (!shouldWakeUp(order, currentPriceUsd)) continue;
      const payload = buildPayload(order, currentPriceUsd);
      if (!payload) continue;

      let quote: ExecutableTriggerDecision;
      try {
        quote = await quoteExecutableTrigger({
          walletAddress: order.user.walletAddress,
          payload,
        });
      } catch (err) {
        summary.quoteFailures++;
        console.warn('[trigger-monitor] executable quote failed', {
          orderId: order.id,
          ticker,
          kind: order.kind,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (quote.kind === 'waiting') {
        summary.quoteWaiting++;
        console.info('[trigger-monitor] executable quote waiting', {
          orderId: order.id,
          ticker,
          kind: order.kind,
          reason: quote.reason,
          triggerPriceUsd: payload.triggerPriceUsd,
          currentPriceUsd: payload.currentPriceUsd,
          executablePriceUsd: quote.executionEvidence.executionPrice,
        });
        continue;
      }

      const triggerablePayload = withExecutableQuote(payload, quote.executionEvidence);
      summary.hits++;
      const dispatch = await dispatchTriggeredOrderExecution({
        io,
        userId: order.userId,
        walletAddress: order.user.walletAddress,
        payload: triggerablePayload,
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
