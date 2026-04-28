'use client';

import { create } from 'zustand';
import type { Mandate } from '@hunch-it/shared';

/**
 * Per-domain mandate cache. The authoritative source is the GET /api/mandates
 * query (useMandate), but components that need the mandate during a write
 * cycle — e.g. ProposalModal computing `size > maxTradeSize` — can read
 * the snapshot here without subscribing to TanStack Query.
 *
 * Hydrated by useMandate via setMandate; cleared on logout.
 */

interface MandateStoreState {
  mandate: Mandate | null;
  setMandate: (m: Mandate | null) => void;
}

export const useMandateStore = create<MandateStoreState>((set) => ({
  mandate: null,
  setMandate: (m) => set({ mandate: m }),
}));
