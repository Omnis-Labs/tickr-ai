// Order Tracker — every 30s, polls Jupiter Trigger Order History API for
// each user's open orders, mirrors fills / expirations / cancellations into
// our DB, and emits `trade:filled` / `position:updated` over Socket.IO.
//
// Per spec §Flow 4 (BUY fills), §Flow 5 (TP/SL OCO), §Flow 8 (cancel BUY
// pending).
//
// Phase F: when the user has flipped delegationActive=true and the Privy
// server SDK is configured, OCO sibling cancellation runs server-side
// without prompting. Otherwise we still emit `position:updated
// action=cancel-sibling` so the frontend can show a "Sign & withdraw" banner
// (Phase E behavior).

import type { PrismaClient } from '@prisma/client';
import type { Server as IoServer } from 'socket.io';
import { WsServerEvents } from '@hunch-it/shared';
import { isDelegationConfigured, signTransactionDelegated } from '../privy/index.js';

const JUPITER_BASE = process.env.NEXT_PUBLIC_JUPITER_API_BASE ?? 'https://lite-api.jup.ag';
const JUPITER_HISTORY = '/trigger/v2/orders/history';
const JUPITER_CANCEL_INITIATE = '/trigger/v2/orders/cancel/initiate';
const JUPITER_CANCEL_CONFIRM = '/trigger/v2/orders/cancel/confirm';

/**
 * Attempt to cancel a Jupiter trigger order via the Privy delegated server
 * signer. Returns true if the cancel was submitted on-chain; false means the
 * caller should fall back to emitting position:updated for user-prompted
 * signing.
 */
async function tryDelegatedCancel(
  prisma: PrismaClient,
  jupiterOrderId: string,
  privyWalletId: string,
): Promise<boolean> {
  if (!isDelegationConfigured()) return false;
  try {
    const initiateRes = await fetch(`${JUPITER_BASE}${JUPITER_CANCEL_INITIATE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: jupiterOrderId }),
    });
    if (!initiateRes.ok) return false;
    const initiateJson = (await initiateRes.json()) as { transaction?: string };
    if (!initiateJson.transaction) return false;

    const signed = await signTransactionDelegated({
      privyWalletId,
      transactionBase64: initiateJson.transaction,
    });
    if (!signed) return false;

    const confirmRes = await fetch(`${JUPITER_BASE}${JUPITER_CANCEL_CONFIRM}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: jupiterOrderId,
        signedWithdrawalTx: signed,
      }),
    });
    if (!confirmRes.ok) return false;

    const order = await prisma.order.findFirst({
      where: { jupiterOrderId },
      select: { id: true },
    });
    if (order) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
    }
    return true;
  } catch (err) {
    console.warn('[privy] delegated cancel failed', err);
    return false;
  }
}

type JupiterOrderStatus =
  | 'OPEN'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'CANCELLED'
  | 'EXPIRED';

interface JupiterHistoryEntry {
  id: string;
  status: JupiterOrderStatus;
  filledAmount?: string;
  outAmount?: string;
  inAmount?: string;
  filledAt?: number;
  expiresAt?: number;
}

async function fetchHistoryForWallet(walletAddress: string): Promise<JupiterHistoryEntry[]> {
  const url = `${JUPITER_BASE}${JUPITER_HISTORY}?wallet=${encodeURIComponent(walletAddress)}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`[tracker] jupiter history ${walletAddress.slice(0, 6)}… ${res.status}`);
      return [];
    }
    const j = (await res.json()) as { orders?: JupiterHistoryEntry[] };
    return j.orders ?? [];
  } catch (err) {
    console.warn('[tracker] jupiter history fetch failed', err);
    return [];
  }
}

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
          await applyFill(prisma, io, order, remote);
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

async function applyFill(
  prisma: PrismaClient,
  io: IoServer,
  order: Awaited<ReturnType<PrismaClient['order']['findMany']>>[number] & {
    user: {
      walletAddress: string;
      privyWalletId: string | null;
      delegationActive: boolean;
    } | null;
    position: { id: string; ticker: string; tokenAmount: number; entryPrice: number };
  },
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
    // BUY filled → Position transitions to ENTERING. The user must now
    // place TP/SL via Position Detail (delegated server-side signing not
    // wired in Phase D).
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
    const tokenAmount = order.position.tokenAmount;
    const realizedPnl = executionPrice
      ? (executionPrice - order.position.entryPrice) * tokenAmount
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
      // Phase F: try server-side delegated cancel first. Falls back to a
      // user-prompted banner via position:updated if the user hasn't opted
      // in or Privy isn't configured.
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
