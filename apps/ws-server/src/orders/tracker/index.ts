// Order Tracker — every ~30s polls Jupiter Trigger v2 history for each
// user with open orders, mirrors fill / expiry / cancel state into our
// DB, and emits trade:filled / position:updated over Socket.IO.
//
// v2 changes vs the v1-style tracker we replaced:
//   - Auth is per-user JWT (User.jupiterJwt), persisted by the web
//     client after challenge/verify. No JWT → skip that user's poll.
//   - History endpoint returns events[] not flat status; we use
//     reduceOrderState() to collapse to one of OPEN / PARTIALLY_FILLED
//     / FILLED / CANCELLED / EXPIRED.
//   - Native OCO orders. The "sibling cancel" logic that used to live
//     in oco.ts is gone — Jupiter handles it server-side, we just see
//     a single cancelled event on the losing leg.

import type { PrismaClient } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import { WsServerEvents } from '@hunch-it/shared';
import {
  fetchActiveOrdersForUser,
  reduceOrderState,
  type JupiterOrderV2,
} from './jupiter-history.js';
import { applyFill, type OrderForFill } from './fills.js';

export interface TrackerSummary {
  polledUsers: number;
  ordersChecked: number;
  fills: number;
  expirations: number;
  cancellations: number;
  errors: number;
  skippedNoJwt: number;
}

export async function runOrderTracker(
  prisma: PrismaClient,
  io: IoServer,
): Promise<TrackerSummary> {
  const summary: TrackerSummary = {
    polledUsers: 0,
    ordersChecked: 0,
    fills: 0,
    expirations: 0,
    cancellations: 0,
    errors: 0,
    skippedNoJwt: 0,
  };

  const open = await prisma.order.findMany({
    where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
    include: { user: true, position: true },
  });
  if (open.length === 0) return summary;

  // Group by user so we hit Jupiter once per user not once per order.
  const byUser = new Map<string, { user: NonNullable<(typeof open)[number]['user']>; orders: typeof open }>();
  for (const o of open) {
    if (!o.user) continue;
    const cur = byUser.get(o.user.id);
    if (cur) cur.orders.push(o);
    else byUser.set(o.user.id, { user: o.user, orders: [o] });
  }

  for (const { user, orders } of byUser.values()) {
    summary.polledUsers++;
    const jwt = isJwtUsable(user.jupiterJwt, user.jupiterJwtExpiresAt) ? user.jupiterJwt : null;
    if (!jwt) {
      summary.skippedNoJwt++;
      continue;
    }

    const remoteOrders = await fetchActiveOrdersForUser({ jupiterJwt: jwt });
    const byJupiterId = new Map<string, JupiterOrderV2>();
    for (const r of remoteOrders) byJupiterId.set(r.id, r);

    for (const order of orders) {
      summary.ordersChecked++;
      if (!order.jupiterOrderId) continue;
      const remote = byJupiterId.get(order.jupiterOrderId);
      // active=false response: order has dropped out of `active` view —
      // could be filled / cancelled / expired. Fetch past once we
      // detect this state to confirm. For now skip; next tick will
      // re-poll. (If the loss persists we could fall back to past=true.)
      if (!remote) continue;

      try {
        const { status, lastFill } = reduceOrderState(remote);
        if (status === 'FILLED' || status === 'PARTIALLY_FILLED') {
          await applyFill(prisma, io, order as OrderForFill, remote, lastFill);
          summary.fills++;
        } else if (status === 'EXPIRED') {
          await prisma.order.update({ where: { id: order.id }, data: { status: 'EXPIRED' } });
          io.to(`user:${user.walletAddress}`).emit(WsServerEvents.TradeExpired, {
            tradeId: order.id,
            ticker: order.position.ticker,
          });
          summary.expirations++;
        } else if (status === 'CANCELLED') {
          await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
          summary.cancellations++;
        }
      } catch (err) {
        console.warn(`[tracker] reconcile ${order.id} failed`, err);
        summary.errors++;
      }
    }
  }

  return summary;
}

function isJwtUsable(token: string | null | undefined, expiresAt: Date | null | undefined): boolean {
  if (!token) return false;
  if (!expiresAt) return false;
  // Refresh-margin: drop tokens within 60s of expiry so we don't poll
  // and fail. Web client refreshes them on re-visit.
  return expiresAt.getTime() - 60_000 > Date.now();
}
