// Jupiter Trigger v2 history client (server-side).
//
// Used by the Order Tracker every ~30s to reconcile each user's open
// trigger orders against Jupiter's authoritative state. v2 history is
// authenticated — we need the user's Jupiter JWT (obtained client-side
// via challenge/verify and persisted to User.jupiterJwt). Without a
// JWT we silently skip; the web app populates it the first time the
// user places an order.
//
// Spec: GET /trigger/v2/orders/history?state=active|past&...
// Response: { orders: [{ id, orderState, events: [...], ... }] }

import { env } from '../../env.js';

const JUPITER_BASE_V2 = env.NEXT_PUBLIC_JUPITER_API_BASE_V2 ?? 'https://api.jup.ag';

export type FillEventContext = 'take_profit' | 'stop_loss' | 'buy_above' | 'buy_below';
export type EventType = 'deposit' | 'fill' | 'withdrawal' | 'cancelled' | 'expired';

export interface OrderEvent {
  type: EventType;
  timestamp: number;
  txSignature?: string;
  mint?: string;
  amount?: string;
  state?: string;
  outputMint?: string;
  outputAmount?: string;
  orderContext?: FillEventContext;
}

export interface JupiterOrderV2 {
  id: string;
  orderType: 'single' | 'OCO' | 'OTOCO';
  orderState: string;
  rawState: string;
  userPubkey: string;
  inputMint: string;
  initialInputAmount: string;
  remainingInputAmount: string;
  outputMint: string;
  triggerMint: string;
  triggerCondition?: 'above' | 'below';
  triggerPriceUsd?: number;
  slippageBps?: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  triggeredAt?: number;
  outputAmount?: string;
  inputUsed?: string;
  fillPercent?: number;
  events: OrderEvent[];
}

interface OrderHistoryResponse {
  orders: JupiterOrderV2[];
  pagination: { total: number; limit: number; offset: number };
}

/**
 * Fetch a user's active trigger orders. Returns [] on any failure
 * (missing JWT, missing api key, network, 4xx) — caller treats as
 * "nothing to reconcile this tick" and tries again next cycle.
 */
export async function fetchActiveOrdersForUser(input: {
  jupiterJwt: string | null;
  state?: 'active' | 'past';
}): Promise<JupiterOrderV2[]> {
  if (!env.JUPITER_API_KEY) return [];
  if (!input.jupiterJwt) return [];

  const url = new URL(`${JUPITER_BASE_V2}/trigger/v2/orders/history`);
  url.searchParams.set('state', input.state ?? 'active');
  url.searchParams.set('limit', '100');

  try {
    const res = await fetch(url, {
      headers: {
        'x-api-key': env.JUPITER_API_KEY,
        Authorization: `Bearer ${input.jupiterJwt}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      // 401 = JWT expired / revoked. Caller can wipe the JWT row to
      // force re-auth on the user's next visit. We just log + skip.
      if (res.status === 401) {
        console.warn('[tracker] jupiter history 401 — JWT expired/invalid');
      } else {
        console.warn(`[tracker] jupiter history ${res.status}`);
      }
      return [];
    }
    const j = (await res.json()) as OrderHistoryResponse;
    return j.orders ?? [];
  } catch (err) {
    console.warn('[tracker] jupiter history fetch failed', err);
    return [];
  }
}

/**
 * Helper: map an order's events[] into the most recent meaningful
 * status. Tracker uses this to decide whether to mark our local Order
 * row as FILLED / CANCELLED / EXPIRED.
 */
export function reduceOrderState(order: JupiterOrderV2): {
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  lastFill?: OrderEvent;
} {
  // Walk events newest-last (Jupiter spec keeps them ordered ascending).
  let status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED' = 'OPEN';
  let lastFill: OrderEvent | undefined;
  for (const ev of order.events ?? []) {
    if (ev.type === 'fill') {
      lastFill = ev;
      // remainingInputAmount=0 means the leg fully closed.
      status =
        Number(order.remainingInputAmount) === 0 || (order.fillPercent ?? 0) >= 1
          ? 'FILLED'
          : 'PARTIALLY_FILLED';
    } else if (ev.type === 'cancelled') {
      status = 'CANCELLED';
    } else if (ev.type === 'expired') {
      status = 'EXPIRED';
    }
  }
  // Fallback to orderState text when events are sparse (e.g. no fills yet).
  if (status === 'OPEN') {
    const s = order.orderState?.toLowerCase() ?? '';
    if (s.includes('cancel')) status = 'CANCELLED';
    else if (s.includes('expir')) status = 'EXPIRED';
    else if (s === 'filled') status = 'FILLED';
    else if (s.startsWith('partial')) status = 'PARTIALLY_FILLED';
  }
  return { status, lastFill };
}

// Re-export the single-order fetch helper used by oco.ts callers — but
// in v2 we don't need a "fetch by id" call, the caller already polled
// history. Kept the export name for compat with the legacy `jupiterUrl`
// import; it now just builds the v2 base + path.
export function jupiterUrl(path: string): string {
  if (!path.startsWith('/')) throw new Error(`jupiterUrl: path must start with / (got "${path}")`);
  return `${JUPITER_BASE_V2}${path}`;
}
