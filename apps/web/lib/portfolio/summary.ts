import { num } from '../utils/fmt';
import {
  portfolioPositionsToHoldings,
  type Holding,
  type PortfolioPosition,
} from './holdings';

export interface PortfolioSummaryInput {
  positions?: PortfolioPosition[];
  cashUsd?: number | null;
  pnl?: {
    realized?: number | null;
    unrealized?: number | null;
  } | null;
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
  cashUsd: number;
  positionsValue: number;
  totalValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dayPnl: number;
  totalPnl: number;
  dayPnlPct: number;
  totalPnlPct: number;
  dayPnlPositive: boolean;
  totalPnlPositive: boolean;
  hasCash: boolean;
  hasHoldings: boolean;
}

export function buildPortfolioSummary(input: PortfolioSummaryInput): PortfolioSummary {
  const positions = input.positions ?? [];
  const holdings = portfolioPositionsToHoldings(positions);
  const cashUsd = num(input.cashUsd);
  const realizedPnl = num(input.pnl?.realized);
  const unrealizedPnl = num(input.pnl?.unrealized);
  const positionsValue = holdings.reduce((acc, h) => acc + h.value, 0);
  const totalValue = positionsValue + cashUsd;
  const dayPnl = unrealizedPnl;
  const totalPnl = realizedPnl + unrealizedPnl;
  const dayPnlPct = totalValue > 0 ? dayPnl / totalValue : 0;
  const totalPnlPct = totalValue > 0 ? totalPnl / totalValue : 0;

  return {
    holdings,
    closablePositions: positions
      .filter((p) => p.state === 'ACTIVE' && p.tokenAmount > 0)
      .map((p) => ({
        id: p.id,
        ticker: p.ticker,
        tokenAmount: num(p.tokenAmount),
        entryPrice: num(p.avgCost),
        state: p.state ?? 'ACTIVE',
      })),
    cashUsd,
    positionsValue,
    totalValue,
    realizedPnl,
    unrealizedPnl,
    dayPnl,
    totalPnl,
    dayPnlPct,
    totalPnlPct,
    dayPnlPositive: dayPnl >= 0,
    totalPnlPositive: totalPnl >= 0,
    hasCash: cashUsd > 0,
    hasHoldings: holdings.length > 0,
  };
}
