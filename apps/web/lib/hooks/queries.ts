'use client';

import { useQuery } from '@tanstack/react-query';
import type { Mandate, Proposal } from '@hunch-it/shared';
import { useAuthedFetch } from '@/lib/auth/fetch';
import type { PortfolioPosition } from '@/lib/portfolio/holdings';
import { normalizeProposalForClient, normalizeProposalsForClient } from '@/lib/proposals/normalize';
import { useProtectedQueryEnabled } from './protected-query';
import { readProtectedJson } from './protected-response';

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
  const enabled = useProtectedQueryEnabled();
  return useQuery<{ proposals: Proposal[] }>({
    queryKey: QK.proposals(),
    queryFn: async () => {
      const r = await authedFetch('/api/proposals');
      const json = await readProtectedJson<{ proposals?: unknown[] }>(r);
      return { proposals: normalizeProposalsForClient(json.proposals ?? []) };
    },
    refetchInterval: 30_000,
    enabled,
  });
}

export function useProposal(id: string | null | undefined) {
  const authedFetch = useAuthedFetch();
  const enabled = useProtectedQueryEnabled(!!id);
  return useQuery<{ proposal: Proposal | null }>({
    queryKey: id ? QK.proposal(id) : ['proposal', 'null'],
    queryFn: async () => {
      if (!id) return { proposal: null };
      const r = await authedFetch(`/api/proposals/${id}`);
      if (r.status === 404) return { proposal: null };
      const json = await readProtectedJson<{ proposal?: unknown }>(r);
      return { proposal: normalizeProposalForClient(json.proposal) };
    },
    enabled,
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
  const enabled = useProtectedQueryEnabled();
  return useQuery<{ positions: PositionRow[] }>({
    queryKey: QK.positions(),
    queryFn: async () => {
      const r = await authedFetch('/api/positions');
      return readProtectedJson<{ positions: PositionRow[] }>(r);
    },
    refetchInterval: 15_000,
    enabled,
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
 * Single-position detail. 404 returns null so the page can show "Position
 * not found" without throwing.
 */
export function usePosition(id: string | undefined) {
  const authedFetch = useAuthedFetch();
  const enabled = useProtectedQueryEnabled(!!id);
  return useQuery<PositionDetailRow | null>({
    queryKey: id ? QK.position(id) : ['position', 'null'],
    enabled,
    queryFn: async () => {
      if (!id) return null;
      const r = await authedFetch(`/api/positions/${id}`);
      if (r.status === 404) return null;
      const j = await readProtectedJson<{ position?: PositionDetailRow }>(r);
      return j.position ?? null;
    },
    refetchInterval: 20_000,
  });
}

// ── Orders (open) ───────────────────────────────────────────────────────
interface OrderRow {
  id: string;
  positionId: string;
  ticker: string;
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
  const enabled = useProtectedQueryEnabled();
  return useQuery<{ orders: OrderRow[] }>({
    queryKey: QK.orders(),
    queryFn: async () => {
      const r = await authedFetch('/api/orders');
      return readProtectedJson<{ orders: OrderRow[] }>(r);
    },
    refetchInterval: 20_000,
    enabled,
  });
}

// ── Mandate ─────────────────────────────────────────────────────────────
export function useMandate() {
  const authedFetch = useAuthedFetch();
  const enabled = useProtectedQueryEnabled();
  return useQuery<{ mandate: Mandate | null }>({
    queryKey: QK.mandate(),
    queryFn: async () => {
      const r = await authedFetch('/api/mandates');
      return readProtectedJson<{ mandate: Mandate | null }>(r);
    },
    enabled,
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
  const enabled = useProtectedQueryEnabled();
  return useQuery<PortfolioResponse>({
    queryKey: QK.portfolio(),
    queryFn: async () => {
      const r = await authedFetch('/api/portfolio');
      return readProtectedJson<PortfolioResponse>(r);
    },
    refetchInterval: 15_000,
    enabled,
  });
}
