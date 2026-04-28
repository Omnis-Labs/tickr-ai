'use client';

import { useQuery } from '@tanstack/react-query';
import type { DemoProposalShape, Mandate } from '@hunch-it/shared';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { isDemo } from '@/lib/demo/flag';
import { demoInitialPositions, demoInitialTrades, DEMO_MANDATE } from '@hunch-it/shared';

/**
 * Centralised TanStack Query reads. Pages just call these — they don't have
 * to remember to thread `useAuthedFetch`, manage their own loading/error
 * state, or coordinate cache keys for invalidation across mutations.
 *
 * Demo mode short-circuits to in-memory fixtures so the zero-cred UX path
 * keeps rendering populated screens without hitting the backend.
 */

// ── Cache key conventions ───────────────────────────────────────────────
export const QK = {
  proposals: () => ['proposals'] as const,
  proposal: (id: string) => ['proposal', id] as const,
  positions: () => ['positions'] as const,
  position: (id: string) => ['position', id] as const,
  orders: () => ['orders'] as const,
  mandate: () => ['mandate'] as const,
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
export function useMandate() {
  const authedFetch = useAuthedFetch();
  return useQuery<{ mandate: Mandate | null }>({
    queryKey: QK.mandate(),
    queryFn: async () => {
      const r = await authedFetch('/api/mandates');
      if (!r.ok) return { mandate: null };
      return r.json();
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
        return { positions, trades, pnl: { realized, unrealized } };
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
