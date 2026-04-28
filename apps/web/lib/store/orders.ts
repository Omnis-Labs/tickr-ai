'use client';

import { create } from 'zustand';

/**
 * Per-domain store for live socket events that affect the open-orders list
 * (e.g. trade:filled, trade:expired). The HTTP-shaped order list itself
 * lives in TanStack Query (useOpenOrders); this store only carries
 * push-driven UI hints that benefit from instant render before the next
 * refetch tick.
 *
 * Keeping it intentionally small: most order state belongs to the server.
 */

export interface OrderHint {
  orderId: string;
  status: 'FILLED' | 'EXPIRED' | 'CANCELLED';
  receivedAt: string;
}

interface OrdersStoreState {
  hintsById: Record<string, OrderHint>;
  pushHint: (h: OrderHint) => void;
  clearHint: (orderId: string) => void;
}

export const useOrdersStore = create<OrdersStoreState>((set) => ({
  hintsById: {},
  pushHint: (h) =>
    set((s) => ({ hintsById: { ...s.hintsById, [h.orderId]: h } })),
  clearHint: (orderId) =>
    set((s) => {
      const next = { ...s.hintsById };
      delete next[orderId];
      return { hintsById: next };
    }),
}));
