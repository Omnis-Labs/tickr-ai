'use client';

import { useQuery } from '@tanstack/react-query';
import type { DemoProposalShape, Mandate } from '@hunch-it/shared';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { isDemo } from '@/lib/demo/flag';
import { useWallet } from '@/lib/wallet/use-wallet';
import { demoInitialPositions, demoInitialTrades, DEMO_MANDATE } from '@hunch-it/shared';

/**
 * Centralised TanStack Query reads. Pages just call these — they don't have
 * to remember to thread `useAuthedFetch`, manage their own loading/error
 * state, or coordinate cache keys for invalidation across mutations.
 *
 * Demo mode short-circuits to in-memory fixtures so the zero-cred UX path
 * keeps rendering populated screens without hitting the backend.
 */

/**
 * Thrown by hardened query helpers (currently `useMandate`) on any non-2xx
 * response. Carries the HTTP status so consumers can distinguish 401/403
 * (auth race) from 4xx (deterministic) from 5xx (transient) without
 * parsing error messages.
 */
export class FetchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

// ── Cache key conventions ───────────────────────────────────────────────
export const QK = {
  proposals: () => ['proposals'] as const,
  proposal: (id: string) => ['proposal', id] as const,
  positions: () => ['positions'] as const,
  position: (id: string) => ['position', id] as const,
  orders: () => ['orders'] as const,
  mandate: (walletKey?: string) =>
    walletKey ? (['mandate', walletKey] as const) : (['mandate'] as const),
  portfolio: () => ['portfolio'] as const,
};

// ── Proposals ───────────────────────────────────────────────────────────
export function useProposals() {
  const authedFetch = useAuthedFetch();
  return useQuery<{ proposals: DemoProposalShape[] }>({
    queryKey: QK.proposals(),
    queryFn: async () => {
      const r = await authedFetch('/api/proposals');
      if (!r.ok) return { proposals: [] };
      return r.json();
    },
    refetchInterval: 30_000,
    enabled: true,
  });
}

export function useProposal(id: string | null | undefined) {
  const authedFetch = useAuthedFetch();
  return useQuery<{ proposal: DemoProposalShape | null }>({
    queryKey: id ? QK.proposal(id) : ['proposal', 'null'],
    queryFn: async () => {
      if (!id) return { proposal: null };
      const r = await authedFetch(`/api/proposals/${id}`);
      if (!r.ok) return { proposal: null };
      return r.json();
    },
    enabled: !!id,
  });
}

// ── Positions ───────────────────────────────────────────────────────────
interface PositionRow {
  id: string;
  ticker: string;
  state: string;
  tokenAmount: number;
  entryPrice: number;
  currentTpPrice: number | null;
  currentSlPrice: number | null;
  realizedPnl: number | null;
}

export function usePositions() {
  const authedFetch = useAuthedFetch();
  return useQuery<{ positions: PositionRow[] }>({
    queryKey: QK.positions(),
    queryFn: async () => {
      if (isDemo()) {
        // Demo fixtures live in the client store; the API returns empty
        // arrays and the consuming page reads from useDemoPositionsStore.
        return { positions: [] };
      }
      const r = await authedFetch('/api/positions');
      if (!r.ok) return { positions: [] };
      return r.json();
    },
    refetchInterval: 15_000,
  });
}

// ── Orders (open) ───────────────────────────────────────────────────────
interface OrderRow {
  id: string;
  positionId: string;
  kind: string;
  side: string;
  status: string;
  jupiterOrderId: string | null;
  triggerPriceUsd: number | null;
  sizeUsd: number;
  tokenAmount: number | null;
}

export function useOpenOrders() {
  const authedFetch = useAuthedFetch();
  return useQuery<{ orders: OrderRow[] }>({
    queryKey: QK.orders(),
    queryFn: async () => {
      const r = await authedFetch('/api/orders');
      if (!r.ok) return { orders: [] };
      return r.json();
    },
    refetchInterval: 20_000,
  });
}

// ── Mandate ─────────────────────────────────────────────────────────────
/**
 * Hardened mandate read. Three guarantees beyond the other queries here:
 *
 *   1. Wallet-scoped cache key — one user's mandate never leaks into a
 *      different wallet's session, even when both authenticate in the
 *      same browser.
 *   2. Internal readiness gate ANDed with the optional caller `enabled`,
 *      so the query physically cannot fire before Privy + embedded wallet
 *      are ready. Prevents the pre-auth 401 → cached `{ mandate: null }`
 *      cache-poisoning race.
 *   3. Throws `FetchError` on non-2xx instead of swallowing as null, so
 *      callers can distinguish "no mandate exists" (HTTP 200 + null body)
 *      from "auth raced" (401/403) from "server flaked" (5xx). Retry
 *      policy: 401/403 once (token mint race), other 4xx never, 5xx twice.
 *
 * The legacy 200 + `{ mandate: null }` shape from /api/mandates is the
 * documented success-with-empty case for first-touch users; we surface
 * that as data, not error.
 */
export function useMandate(options?: { enabled?: boolean }) {
  const authedFetch = useAuthedFetch();
  const { ready, connected, address } = useWallet();
  const demo = isDemo();
  const walletKey = demo ? 'demo-wallet' : address;
  const internallyReady = demo || (ready && connected && !!address);
  const callerEnabled = options?.enabled ?? true;

  return useQuery<{ mandate: Mandate | null }, FetchError>({
    queryKey: QK.mandate(walletKey ?? 'anonymous'),
    queryFn: async () => {
      const r = await authedFetch('/api/mandates');
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new FetchError(r.status, body?.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    enabled: callerEnabled && internallyReady,
    retry: (failureCount, error) => {
      if (!(error instanceof FetchError)) return failureCount < 2;
      if (error.status === 401 || error.status === 403) return failureCount < 1;
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}

// ── Portfolio ───────────────────────────────────────────────────────────
export interface PortfolioResponse {
  positions: Array<{
    ticker: string;
    tokenAmount: number;
    avgCost: number;
    markPrice?: number;
    pnl?: number;
  }>;
  trades: Array<{
    id: string;
    ticker: string;
    side: 'BUY' | 'SELL';
    amountUsd: number;
    tokenAmount: number;
    executionPrice: number;
    status: string;
    realizedPnl: number;
    createdAt: string;
  }>;
  pnl: { realized: number; unrealized: number };
  cashUsd?: number;
}

export function usePortfolio() {
  const authedFetch = useAuthedFetch();
  return useQuery<PortfolioResponse>({
    queryKey: QK.portfolio(),
    queryFn: async () => {
      if (isDemo()) {
        const positions = demoInitialPositions();
        const trades = demoInitialTrades();
        const realized = trades
          .filter((t) => t.side === 'SELL' && t.status === 'CONFIRMED')
          .reduce((acc, t) => acc + t.realizedPnl, 0);
        const unrealized = positions.reduce((acc, p) => acc + (p.pnl ?? 0), 0);
        return { positions, trades, pnl: { realized, unrealized }, cashUsd: 1234.56 };
      }
      const r = await authedFetch('/api/portfolio');
      if (!r.ok) {
        return {
          positions: [],
          trades: [],
          pnl: { realized: 0, unrealized: 0 },
        } satisfies PortfolioResponse;
      }
      return r.json();
    },
    refetchInterval: 15_000,
  });
}

// ── Demo mandate fallback (used by Settings + Mandate Setup) ────────────
// DEMO_MANDATE comes from shared as a typed fixture but its `marketFocus`
// is widened to string[] for JSON-friendliness — cast on read here.
export function demoMandate(): Mandate {
  return DEMO_MANDATE as unknown as Mandate;
}
