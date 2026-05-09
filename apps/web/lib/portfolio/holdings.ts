import { getAssetById } from '@hunch-it/shared';

export interface PortfolioPosition {
  id: string;
  ticker: string;
  tokenAmount: number;
  avgCost: number;
  markPrice?: number;
  pnl?: number;
  pendingSizeUsd?: number;
  state?: string;
}

export interface Holding {
  id: string;
  assetId: string;
  name: string;
  ticker: string;
  value: number;
  pnl: number;
  pnlPct: number;
  state: string;
  isPendingBuy: boolean;
}

export function portfolioPositionsToHoldings(positions: PortfolioPosition[]): Holding[] {
  return positions
    .filter((p) => {
      if (p.tokenAmount > 0) return true;
      return p.state === 'BUY_PENDING' || p.state === 'ENTERING';
    })
    .map((p) => {
      const meta = getAssetById(p.ticker);
      const state = p.state ?? 'ACTIVE';
      const isPendingBuy = (state === 'BUY_PENDING' || state === 'ENTERING') && p.tokenAmount <= 0;
      const mark = p.markPrice ?? p.avgCost;
      const value = isPendingBuy ? (p.pendingSizeUsd ?? 0) : p.tokenAmount * mark;
      const pnl = isPendingBuy ? 0 : (p.pnl ?? (mark - p.avgCost) * p.tokenAmount);
      const pnlPct = isPendingBuy || p.avgCost <= 0 ? 0 : (mark - p.avgCost) / p.avgCost;
      return {
        id: p.id,
        assetId: p.ticker,
        name: meta?.name ?? p.ticker,
        ticker: meta?.displaySymbol ?? p.ticker,
        value,
        pnl,
        pnlPct,
        state,
        isPendingBuy,
      };
    });
}
