'use client';

import { create } from 'zustand';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';

/**
 * v1.3 demo Position store. One Position per "leg" — same user × ticker may
 * have many independent positions, each with its own TP / SL state machine.
 * Replaces the legacy aggregate Position table from v1.2 demo.
 */
export type DemoPositionState = 'BUY_PENDING' | 'ENTERING' | 'ACTIVE' | 'CLOSING' | 'CLOSED';
export type DemoPositionClosedReason = 'TP_FILLED' | 'SL_FILLED' | 'USER_CLOSE' | null;

export interface DemoPositionUI {
  id: string;
  proposalId: string | null;
  ticker: string;
  mint: string;
  tokenAmount: number;
  entryPrice: number;
  totalCost: number;
  currentTpPrice: number | null;
  currentSlPrice: number | null;
  state: DemoPositionState;
  firstEntryAt: string;
  closedAt: string | null;
  closedReason: DemoPositionClosedReason;
  realizedPnl: number | null;
  // For demo-only mark-to-market display.
  markPrice: number;
}

interface AddArgs {
  proposalId: string | null;
  ticker: string;
  sizeUsd: number;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
}

interface DemoPositionsState {
  positions: DemoPositionUI[];
  addFromProposal: (a: AddArgs) => DemoPositionUI;
  /** Demo state-machine: ENTERING → ACTIVE once user confirms exit orders. */
  confirmExitOrders: (id: string) => void;
  /** Demo simulation: TP or SL fills → CLOSED with realized P&L + sibling cancel surfaced. */
  simulateExitFill: (id: string, kind: 'TP' | 'SL') => void;
  adjustTpSl: (id: string, tp: number | null, sl: number | null) => void;
  closePosition: (
    id: string,
    closedReason: NonNullable<DemoPositionClosedReason>,
    closePrice: number,
  ) => DemoPositionUI | null;
  setMarkPrice: (id: string, mark: number) => void;
  /** Sibling-cancel pending UI hints, keyed by positionId. Set by simulateExitFill. */
  cancelSiblingHints: Record<string, { siblingKind: 'TP' | 'SL'; createdAt: string }>;
  dismissCancelSibling: (positionId: string) => void;
}

function seedPositions(): DemoPositionUI[] {
  // One ACTIVE seed so /portfolio + Position Detail aren't blank cold.
  const aapl = XSTOCKS.AAPL;
  return [
    {
      id: 'demo-pos-AAPL-1',
      proposalId: null,
      ticker: aapl.symbol,
      mint: aapl.mint || 'DeMoMint11111111111111111111111111111111111',
      tokenAmount: 0.0217,
      entryPrice: 230.64,
      totalCost: 0.0217 * 230.64,
      currentTpPrice: 240.0,
      currentSlPrice: 224.0,
      state: 'ACTIVE',
      firstEntryAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      closedAt: null,
      closedReason: null,
      realizedPnl: null,
      markPrice: 234.8,
    },
  ];
}

export const useDemoPositionsStore = create<DemoPositionsState>((set) => ({
  positions: seedPositions(),
  cancelSiblingHints: {},
  addFromProposal: ({ proposalId, ticker, sizeUsd, entryPrice, tpPrice, slPrice }) => {
    const bare = xStockToBare(ticker as XStockTicker);
    const meta = XSTOCKS[bare];
    const tokenAmount = entryPrice > 0 ? +(sizeUsd / entryPrice).toFixed(6) : 0;
    const row: DemoPositionUI = {
      id: `demo-pos-${ticker}-${Date.now()}`,
      proposalId,
      ticker,
      mint: meta?.mint || 'DeMoMint11111111111111111111111111111111111',
      tokenAmount,
      entryPrice,
      totalCost: tokenAmount * entryPrice,
      currentTpPrice: tpPrice,
      currentSlPrice: slPrice,
      // Phase E: demo simulates the full state machine. Position lands in
      // ENTERING (BUY filled, TP/SL not yet placed). Position Detail shows a
      // banner prompting the user to confirm exit orders → ACTIVE.
      state: 'ENTERING',
      firstEntryAt: new Date().toISOString(),
      closedAt: null,
      closedReason: null,
      realizedPnl: null,
      markPrice: entryPrice,
    };
    set((s) => ({ positions: [row, ...s.positions] }));
    return row;
  },
  confirmExitOrders: (id) =>
    set((s) => ({
      positions: s.positions.map((p) =>
        p.id === id && p.state === 'ENTERING' ? { ...p, state: 'ACTIVE' } : p,
      ),
    })),
  simulateExitFill: (id, kind) =>
    set((s) => {
      const target = s.positions.find((p) => p.id === id);
      if (!target || target.state !== 'ACTIVE') return s;
      const exitPrice =
        kind === 'TP'
          ? (target.currentTpPrice ?? target.entryPrice * 1.04)
          : (target.currentSlPrice ?? target.entryPrice * 0.975);
      const realized = (exitPrice - target.entryPrice) * target.tokenAmount;
      return {
        positions: s.positions.map((p) =>
          p.id === id
            ? {
                ...p,
                state: 'CLOSED',
                closedAt: new Date().toISOString(),
                closedReason: kind === 'TP' ? 'TP_FILLED' : 'SL_FILLED',
                realizedPnl: +realized.toFixed(2),
                markPrice: exitPrice,
              }
            : p,
        ),
        cancelSiblingHints: {
          ...s.cancelSiblingHints,
          [id]: {
            siblingKind: kind === 'TP' ? 'SL' : 'TP',
            createdAt: new Date().toISOString(),
          },
        },
      };
    }),
  adjustTpSl: (id, tp, sl) =>
    set((s) => ({
      positions: s.positions.map((p) =>
        p.id === id ? { ...p, currentTpPrice: tp, currentSlPrice: sl } : p,
      ),
    })),
  closePosition: (id, closedReason, closePrice) => {
    let closed: DemoPositionUI | null = null;
    set((s) => ({
      positions: s.positions.map((p) => {
        if (p.id !== id) return p;
        const realized = (closePrice - p.entryPrice) * p.tokenAmount;
        closed = {
          ...p,
          state: 'CLOSED',
          closedAt: new Date().toISOString(),
          closedReason,
          realizedPnl: +realized.toFixed(2),
          markPrice: closePrice,
        };
        return closed;
      }),
    }));
    return closed;
  },
  setMarkPrice: (id, mark) =>
    set((s) => ({
      positions: s.positions.map((p) => (p.id === id ? { ...p, markPrice: mark } : p)),
    })),
  dismissCancelSibling: (positionId) =>
    set((s) => {
      if (!s.cancelSiblingHints[positionId]) return s;
      const next = { ...s.cancelSiblingHints };
      delete next[positionId];
      return { cancelSiblingHints: next };
    }),
}));
