'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MandateInput, SkipReason } from '@hunch-it/shared';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { QK } from './queries';

/**
 * Centralised TanStack Query mutations. Each one:
 *   1. Talks to /api via the authed-fetch helper
 *   2. Throws on non-2xx so consumers can `.mutateAsync` + try/catch with
 *      a single error path
 *   3. Invalidates the matching query keys on success — no need for pages
 *      to remember which lists need to refetch after which action
 *
 * Demo mode short-circuiting is the consumer's job — these talk to the
 * real API. Pages still call demo store mutators directly when isDemo().
 */

interface SkipProposalArgs {
  proposalId: string;
  reason: SkipReason;
  detail?: string;
}

export function useSkipProposal() {
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();
  return useMutation({
    mutationFn: async (args: SkipProposalArgs) => {
      const r = await authedFetch('/api/skips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      return r.json() as Promise<{ ok: true }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.proposals() });
    },
  });
}

interface CancelOrderArgs {
  orderId: string;
}

export function useCancelOrder() {
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();
  return useMutation({
    mutationFn: async ({ orderId }: CancelOrderArgs) => {
      const r = await authedFetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
    },
  });
}

interface ClosePositionArgs {
  positionId: string;
  executionPrice: number | null;
  tokenAmount: number | null;
  txSignature: string | null;
}

export function useClosePosition() {
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();
  return useMutation({
    mutationFn: async (args: ClosePositionArgs) => {
      const { positionId, ...body } = args;
      const r = await authedFetch(`/api/positions/${positionId}/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      return r.json();
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.position(vars.positionId) });
      void qc.invalidateQueries({ queryKey: QK.portfolio() });
    },
  });
}

export function useUpsertMandate() {
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();
  return useMutation({
    mutationFn: async (args: { walletAddress: string; first: boolean } & MandateInput) => {
      const { first, ...body } = args;
      const r = await authedFetch('/api/mandates', {
        method: first ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.mandate() });
    },
  });
}

interface ToggleDelegationArgs {
  walletAddress: string;
  privyWalletId?: string;
  delegationActive: boolean;
}

export function useToggleDelegation() {
  const authedFetch = useAuthedFetch();
  return useMutation({
    mutationFn: async (args: ToggleDelegationArgs) => {
      const r = await authedFetch('/api/users/delegation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      return r.json() as Promise<{ ok: true; delegationActive: boolean }>;
    },
  });
}

interface PersistOrderArgs {
  walletAddress: string;
  proposalId?: string | null;
  positionId?: string | null;
  ticker: string;
  kind: 'BUY_TRIGGER' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'CLOSE_SWAP';
  side: 'BUY' | 'SELL';
  triggerPriceUsd: number | null;
  sizeUsd: number;
  tokenAmount?: number | null;
  jupiterOrderId: string;
  txSignature?: string | null;
  slippageBps?: number | null;
  createPosition?: {
    mint: string;
    entryPriceEstimate: number;
    tpPrice: number | null;
    slPrice: number | null;
  };
}

export function usePersistOrder() {
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();
  return useMutation({
    mutationFn: async (args: PersistOrderArgs) => {
      const r = await authedFetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      return r.json() as Promise<{ ok: true; positionId: string }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.proposals() });
    },
  });
}
