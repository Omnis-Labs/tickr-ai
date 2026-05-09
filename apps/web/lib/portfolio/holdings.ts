import { getAssetById } from '@hunch-it/shared';

export interface PortfolioPosition {
  id: string;
  ticker: string;
  tokenAmount: number;
  avgCost: number;
  markPrice?: number;
  pnl?: number;
  state?: 'ACTIVE' | 'CLOSED' | string;
}

export interface Holding {
  id: string;
  assetId: string;
  name: string;
  ticker: string;
  value: number;
  pnl: number;
  pnlPct: number;
  state: 'ACTIVE' | 'CLOSED' | string;
}

export function applyMarkPricesToPortfolioPositions(
  positions: PortfolioPosition[],
  markPrices: ReadonlyMap<string, number>,
): { positions: PortfolioPosition[]; unrealized: number } {
  let unrealized = 0;
  const markedPositions = positions.map((p) => {
    const currentMark = markPrices.get(p.ticker);
    const markPrice =
      currentMark != null && Number.isFinite(currentMark) && currentMark > 0
        ? currentMark
        : (p.markPrice ?? p.avgCost);
    const pnl = (markPrice - p.avgCost) * p.tokenAmount;
    unrealized += pnl;

    return {
      ...p,
      markPrice,
      pnl,
    };
  });

  return { positions: markedPositions, unrealized };
}

export function portfolioPositionsToHoldings(positions: PortfolioPosition[]): Holding[] {
  return positions
    .filter((p) => p.tokenAmount > 0)
    .map((p) => {
      const meta = getAssetById(p.ticker);
      const mark = p.markPrice ?? p.avgCost;
      const value = p.tokenAmount * mark;
      const pnl = p.pnl ?? (mark - p.avgCost) * p.tokenAmount;
      const pnlPct = p.avgCost > 0 ? (mark - p.avgCost) / p.avgCost : 0;
      return {
        id: p.id,
        assetId: p.ticker,
        name: meta?.name ?? p.ticker,
        ticker: meta?.displaySymbol ?? p.ticker,
        value,
        pnl,
        pnlPct,
        state: p.state ?? 'ACTIVE',
      };
    });
}
