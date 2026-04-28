// Order Tracker — every 30s, polls Jupiter Trigger Order History API for
// each user's open orders, mirrors fills / expirations / cancellations into
// our DB, and emits trade:filled / position:updated over Socket.IO.
//
// Per spec §Flow 4 (BUY fills), §Flow 5 (TP/SL OCO), §Flow 8 (cancel BUY
// pending). Phase F: when the user opted into delegated signing, OCO sibling
// cancellation runs server-side via the Privy server SDK without prompting.

import type { PrismaClient } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import { WsServerEvents } from '@hunch-it/shared';
import { fetchHistoryForWallet, type JupiterHistoryEntry } from './jupiter-history.js';
import { applyFill, type OrderForFill } from './fills.js';

export interface TrackerSummary {
  polledWallets: number;
  ordersChecked: number;
  fills: number;
  expirations: number;
  errors: number;
}

/**
 * Single tick: walks all OPEN/PARTIALLY_FILLED orders, fans out per-wallet
 * Jupiter History calls, and reconciles the results into our DB.
 */
export async function runOrderTracker(
  prisma: PrismaClient,
  io: IoServer,
): Promise<TrackerSummary> {
  const summary: TrackerSummary = {
    polledWallets: 0,
    ordersChecked: 0,
    fills: 0,
    expirations: 0,
    errors: 0,
  };

  const open = await prisma.order.findMany({
    where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
    include: { user: true, position: true },
  });
  if (open.length === 0) return summary;

  // Group by wallet so we hit Jupiter once per user.
  const byWallet = new Map<string, typeof open>();
  for (const o of open) {
    if (!o.user?.walletAddress) continue;
    const list = byWallet.get(o.user.walletAddress) ?? [];
    list.push(o);
    byWallet.set(o.user.walletAddress, list);
  }

  for (const [walletAddress, orders] of byWallet) {
    summary.polledWallets++;
    const history = await fetchHistoryForWallet(walletAddress);
    const byJupiterId = new Map<string, JupiterHistoryEntry>();
    for (const h of history) byJupiterId.set(h.id, h);

    for (const order of orders) {
      summary.ordersChecked++;
      if (!order.jupiterOrderId) continue;
      const remote = byJupiterId.get(order.jupiterOrderId);
      if (!remote) continue;

      try {
        if (remote.status === 'FILLED' || remote.status === 'PARTIALLY_FILLED') {
          await applyFill(prisma, io, order as OrderForFill, remote);
          summary.fills++;
        } else if (remote.status === 'EXPIRED') {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'EXPIRED' },
          });
          io.to(`user:${walletAddress}`).emit(WsServerEvents.TradeExpired, {
            tradeId: order.id,
            ticker: order.position.ticker,
          });
          summary.expirations++;
        } else if (remote.status === 'CANCELLED') {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'CANCELLED' },
          });
        }
      } catch (err) {
        console.warn(`[tracker] reconcile ${order.id} failed`, err);
        summary.errors++;
      }
    }
  }

  return summary;
}
