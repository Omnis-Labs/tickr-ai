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
  adjustTpSl: (id: string, tp: number | null, sl: number | null) => void;
  closePosition: (
    id: string,
    closedReason: NonNullable<DemoPositionClosedReason>,
    closePrice: number,
  ) => DemoPositionUI | null;
  setMarkPrice: (id: string, mark: number) => void;
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
      // Demo: skip BUY_PENDING/ENTERING because there's no real chain. Treat
      // the order as immediately filled with TP/SL attached.
      state: 'ACTIVE',
      firstEntryAt: new Date().toISOString(),
      closedAt: null,
      closedReason: null,
      realizedPnl: null,
      markPrice: entryPrice,
    };
    set((s) => ({ positions: [row, ...s.positions] }));
    return row;
  },
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
}));
