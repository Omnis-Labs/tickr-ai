// Price-trigger monitor for synthetic xStock orders.
//
// xStocks are off Jupiter Trigger v2's allowlist (Backed Finance
// tokens, traded via Solana DEXs Jupiter Ultra aggregates), so we
// can't deposit into a Jupiter vault and have them watch the price.
// Instead, on Approve we persist the order intent in our DB with no
// jupiterOrderId, and this monitor watches Pyth every ~30s. When a
// trigger condition fires, we emit a `trigger:hit` Socket.IO event to
// the user's room; the web app shows a sticky toast that lets them
// 1-tap-execute the swap via Jupiter Ultra (ws-server can do it
// server-side once Privy Pro server signers are configured).
//
// Conditions:
//   TAKE_PROFIT  → fire when current ≥ triggerPriceUsd
//   STOP_LOSS    → fire when current ≤ triggerPriceUsd
//   BUY_TRIGGER  → fire when current is within 0.5% of triggerPriceUsd
//                  (we don't store direction; the tolerance band
//                   catches both limit-buy on dip and breakout-above)
//
// We don't change Order.status here — the order stays OPEN. The user's
// execute click is what flips it to FILLED + writes a Trade row.
// That keeps the monitor idempotent: re-firing while the user
// deliberates is fine, the toast just stays visible.

import type { PrismaClient } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import {
  WsServerEvents,
  xStockToBare,
  type BareTicker,
  type XStockTicker,
} from '@hunch-it/shared';
import { getLatestPrices } from '../pyth/index.js';

export interface TriggerMonitorSummary {
  polledOrders: number;
  uniqueTickers: number;
  hits: number;
}

const BUY_TOLERANCE = 0.005; // 0.5%

export async function runTriggerMonitor(
  prisma: PrismaClient,
  io: IoServer,
): Promise<TriggerMonitorSummary> {
  const open = await prisma.order.findMany({
    where: {
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      triggerPriceUsd: { not: null },
      // Synthetic only — Jupiter-routed orders are reconciled via the
      // history poller, not here.
      jupiterOrderId: null,
    },
    include: { user: true, position: true },
  });
  const summary: TriggerMonitorSummary = {
    polledOrders: open.length,
    uniqueTickers: 0,
    hits: 0,
  };
  if (open.length === 0) return summary;

  // Group orders by bare ticker so we hit Pyth once per asset.
  const byTicker = new Map<BareTicker, typeof open>();
  for (const o of open) {
    let bare: BareTicker;
    try {
      bare = xStockToBare(o.position.ticker as XStockTicker);
    } catch {
      continue;
    }
    const list = byTicker.get(bare) ?? [];
    list.push(o);
    byTicker.set(bare, list);
  }
  summary.uniqueTickers = byTicker.size;

  const tickers = Array.from(byTicker.keys());
  const prices = await getLatestPrices(tickers);

  for (const [ticker, orders] of byTicker) {
    const snap = prices.get(ticker);
    if (!snap) continue;
    const currentPriceUsd = snap.price;

    for (const order of orders) {
      if (!order.user) continue;
      const trigger = order.triggerPriceUsd?.toNumber();
      if (trigger == null || !Number.isFinite(trigger) || trigger <= 0) continue;

      let hit = false;
      if (order.kind === 'TAKE_PROFIT') {
        hit = currentPriceUsd >= trigger;
      } else if (order.kind === 'STOP_LOSS') {
        hit = currentPriceUsd <= trigger;
      } else if (order.kind === 'BUY_TRIGGER') {
        hit = Math.abs(currentPriceUsd - trigger) / trigger < BUY_TOLERANCE;
      }
      if (!hit) continue;

      summary.hits++;
      io.to(`user:${order.user.walletAddress}`).emit(WsServerEvents.TriggerHit, {
        orderId: order.id,
        positionId: order.positionId,
        ticker: order.position.ticker, // assetId, e.g. "GOOGLx"
        mint: order.position.mint,
        kind: order.kind,
        side: order.side,
        triggerPriceUsd: trigger,
        currentPriceUsd,
        sizeUsd: order.sizeUsd.toNumber(),
        // For TP/SL the BUY-fill settle endpoint stamped the Order with
        // the exact tokens to sell — pass it through so the client sells
        // the position size, not the full wallet balance (which can
        // include unrelated dust or a separate position in the same
        // mint). BUY_TRIGGER orders don't have this set.
        tokenAmount: order.tokenAmount?.toNumber() ?? null,
      });
    }
  }

  return summary;
}
