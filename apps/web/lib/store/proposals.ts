'use client';

import { create } from 'zustand';
import type { Proposal } from '@hunch-it/shared';
import { isLiveProposal } from '@/lib/proposals/expiration';
import { normalizeProposalForClient, normalizeProposalsForClient } from '@/lib/proposals/normalize';

export type ProposalUI = Proposal;

interface ProposalsState {
  proposalsById: Record<string, ProposalUI>;
  order: string[]; // most recent first
  upsertProposal: (p: ProposalUI) => void;
  removeProposal: (id: string) => void;
  clearExpired: () => void;
  hydrate: (list: ProposalUI[]) => void;
}

export const useProposalsStore = create<ProposalsState>((set) => ({
  proposalsById: {},
  order: [],
  upsertProposal: (p) =>
    set((state) => {
      const proposal = normalizeProposalForClient(p);
      if (!proposal) return state;
      if (!isLiveProposal(proposal)) {
        if (!state.proposalsById[proposal.id]) return state;
        const next = { ...state.proposalsById };
        delete next[proposal.id];
        return { proposalsById: next, order: state.order.filter((x) => x !== proposal.id) };
      }
      if (state.proposalsById[proposal.id]) {
        return { ...state, proposalsById: { ...state.proposalsById, [proposal.id]: proposal } };
      }
      return {
        proposalsById: { ...state.proposalsById, [proposal.id]: proposal },
        order: [proposal.id, ...state.order].slice(0, 100),
      };
    }),
  removeProposal: (id) =>
    set((state) => {
      if (!state.proposalsById[id]) return state;
      const next = { ...state.proposalsById };
      delete next[id];
      return { proposalsById: next, order: state.order.filter((x) => x !== id) };
    }),
  clearExpired: () =>
    set((state) => {
      const now = Date.now();
      const next: Record<string, ProposalUI> = {};
      const order: string[] = [];
      for (const id of state.order) {
        const p = state.proposalsById[id];
        if (!p) continue;
        if (isLiveProposal(p, now)) {
          next[id] = p;
          order.push(id);
        }
      }
      return { proposalsById: next, order };
    }),
  hydrate: (list) =>
    set(() => {
      const proposalsById: Record<string, ProposalUI> = {};
      const order: string[] = [];
      for (const p of normalizeProposalsForClient(list)) {
        if (!isLiveProposal(p)) continue;
        proposalsById[p.id] = p;
        order.push(p.id);
      }
      return { proposalsById, order };
    }),
}));
