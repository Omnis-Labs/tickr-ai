import {
  portfolioPositionsToHoldings,
  type Holding,
  type PortfolioPosition,
} from './holdings';

export interface PortfolioSummaryInput {
  positions?: PortfolioPosition[];
  pnl?: {
    realized?: number;
    unrealized?: number;
  };
  cashUsd?: number;
}

export interface PortfolioSummary {
  holdings: Holding[];
  positionsCount: number;
  hasHoldings: boolean;
  realized: number;
  unrealized: number;
  totalPnl: number;
  dayPnl: number;
  cashUsd: number;
  positionsValue: number;
  totalValue: number;
  totalPnlPct: number;
  dayPnlPct: number;
  dayPnlPositive: boolean;
  totalPnlPositive: boolean;
}

/**
 * Canonical client-side portfolio summary derivation. "Day" P&L is currently
 * unrealized P&L because the product does not track a separate 24h delta yet.
 */
export function derivePortfolioSummary(
  data: PortfolioSummaryInput | null | undefined,
): PortfolioSummary {
  const holdings = portfolioPositionsToHoldings(data?.positions ?? []);
  const realized = data?.pnl?.realized ?? 0;
  const unrealized = data?.pnl?.unrealized ?? 0;
  const totalPnl = realized + unrealized;
  const dayPnl = unrealized;
  const cashUsd = data?.cashUsd ?? 0;
  const positionsValue = holdings.reduce((acc, h) => acc + h.value, 0);
  const totalValue = positionsValue + cashUsd;
  const totalPnlPct = totalValue > 0 ? totalPnl / totalValue : 0;
  const dayPnlPct = totalValue > 0 ? dayPnl / totalValue : 0;
  const dayPnlPositive = dayPnl >= 0;
  const totalPnlPositive = totalPnl >= 0;

  return {
    holdings,
    positionsCount: holdings.length,
    hasHoldings: holdings.length > 0,
    realized,
    unrealized,
    totalPnl,
    dayPnl,
    cashUsd,
    positionsValue,
    totalValue,
    totalPnlPct,
    dayPnlPct,
    dayPnlPositive,
    totalPnlPositive,
  };
}
