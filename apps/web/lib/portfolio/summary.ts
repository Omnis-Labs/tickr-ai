import { num } from '../utils/fmt';
import {
  portfolioPositionsToHoldings,
  type Holding,
  type PortfolioPosition,
} from './holdings';

export interface PortfolioSummaryInput {
  positions?: PortfolioPosition[];
  pnl?: {
    realized?: number | null;
    unrealized?: number | null;
  } | null;
  cashUsd?: number | null;
}

export interface ClosablePortfolioPosition {
  id: string;
  ticker: string;
  tokenAmount: number;
  entryPrice: number;
  state: string;
}

export interface PortfolioSummary {
  holdings: Holding[];
  closablePositions: ClosablePortfolioPosition[];
  positionsCount: number;
  hasHoldings: boolean;
  hasCash: boolean;
  realized: number;
  unrealized: number;
  realizedPnl: number;
  unrealizedPnl: number;
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
  const positions = data?.positions ?? [];
  const holdings = portfolioPositionsToHoldings(positions);
  const realized = num(data?.pnl?.realized);
  const unrealized = num(data?.pnl?.unrealized);
  const totalPnl = realized + unrealized;
  const dayPnl = unrealized;
  const cashUsd = num(data?.cashUsd);
  const positionsValue = holdings.reduce(
    (acc, h) => acc + (h.isPendingBuy ? 0 : h.value),
    0,
  );
  const totalValue = positionsValue + cashUsd;
  const totalPnlPct = totalValue > 0 ? totalPnl / totalValue : 0;
  const dayPnlPct = totalValue > 0 ? dayPnl / totalValue : 0;
  const dayPnlPositive = dayPnl >= 0;
  const totalPnlPositive = totalPnl >= 0;
  const closablePositions = positions
    .filter((p) => (p.state ?? 'ACTIVE') === 'ACTIVE' && num(p.tokenAmount) > 0)
    .map((p) => ({
      id: p.id,
      ticker: p.ticker,
      tokenAmount: num(p.tokenAmount),
      entryPrice: num(p.avgCost),
      state: p.state ?? 'ACTIVE',
    }));

  return {
    holdings,
    closablePositions,
    positionsCount: positions.filter((p) => num(p.tokenAmount) > 0).length,
    hasHoldings: holdings.length > 0,
    hasCash: cashUsd > 0,
    realized,
    unrealized,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
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

export function buildPortfolioSummary(
  input: PortfolioSummaryInput | null | undefined,
): PortfolioSummary {
  return derivePortfolioSummary(input);
}
