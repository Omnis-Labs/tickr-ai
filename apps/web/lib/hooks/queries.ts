'use client';

import { useQuery } from '@tanstack/react-query';
import type { Mandate, Proposal } from '@hunch-it/shared';
import { useAuthedFetch } from '@/lib/auth/fetch';
import type { PortfolioPosition } from '@/lib/portfolio/holdings';
import { normalizeProposalForClient, normalizeProposalsForClient } from '@/lib/proposals/normalize';

/**
 * Centralised TanStack Query reads. Pages just call these — they don't have
 * to remember to thread `useAuthedFetch`, manage their own loading/error
 * state, or coordinate cache keys for invalidation across mutations.
 *
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
  return useQuery<{ proposals: Proposal[] }>({
    queryKey: QK.proposals(),
    queryFn: async () => {
      const r = await authedFetch('/api/proposals');
      if (!r.ok) return { proposals: [] };
      const json = (await r.json()) as { proposals?: unknown[] };
      return { proposals: normalizeProposalsForClient(json.proposals ?? []) };
    },
    refetchInterval: 30_000,
    enabled: true,
  });
}

export function useProposal(id: string | null | undefined) {
  const authedFetch = useAuthedFetch();
  return useQuery<{ proposal: Proposal | null }>({
    queryKey: id ? QK.proposal(id) : ['proposal', 'null'],
    queryFn: async () => {
      if (!id) return { proposal: null };
      const r = await authedFetch(`/api/proposals/${id}`);
      if (!r.ok) return { proposal: null };
      const json = (await r.json()) as { proposal?: unknown };
      return { proposal: normalizeProposalForClient(json.proposal) };
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
      const r = await authedFetch('/api/positions');
      if (!r.ok) return { positions: [] };
      return r.json();
    },
    refetchInterval: 15_000,
  });
}

interface PositionDetailRow {
  id: string;
  userId: string;
  ticker: string;
  mint: string;
  state: string;
  tokenAmount: number;
  entryPrice: number;
  totalCost: number;
  currentTpPrice: number | null;
  currentSlPrice: number | null;
  firstEntryAt: string;
  closedAt: string | null;
  closedReason: string | null;
  realizedPnl: number | null;
  orders?: Array<{
    id: string;
    kind: string;
    side: string;
    status: string;
    triggerPriceUsd: number | null;
    jupiterOrderId: string | null;
  }>;
}

/**
 * Single-position detail. 404 / unauthorized return null so the page can
 * show "Position not found" without throwing.
 */
export function usePosition(id: string | undefined) {
  const authedFetch = useAuthedFetch();
  return useQuery<PositionDetailRow | null>({
    queryKey: id ? QK.position(id) : ['position', 'null'],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const r = await authedFetch(`/api/positions/${id}`);
      if (!r.ok) return null;
      const j = (await r.json()) as { position?: PositionDetailRow };
      return j.position ?? null;
    },
    refetchInterval: 20_000,
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
  positions: PortfolioPosition[];
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
  solBalance?: number;
}

export function usePortfolio() {
  const authedFetch = useAuthedFetch();
  return useQuery<PortfolioResponse>({
    queryKey: QK.portfolio(),
    queryFn: async () => {
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
