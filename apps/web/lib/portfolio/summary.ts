import { num } from '../utils/fmt';
import {
  applyMarkPricesToPortfolioPositions,
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

interface NumberLike {
  toNumber(): number;
}

type NumericInput = NumberLike | number | null | undefined;

export interface PortfolioResponsePositionRow {
  id: string;
  ticker: string;
  tokenAmount: NumericInput;
  entryPrice: NumericInput;
  state: string;
  firstEntryAt?: Date;
  orders?: Array<{ sizeUsd: NumericInput }>;
}

export interface PortfolioResponseTradeRow {
  id: string;
  ticker: string;
  side: string;
  actualSizeUsd: NumericInput;
  filledAmount?: NumericInput;
  executionPrice?: NumericInput;
  realizedPnl?: NumericInput;
  createdAt: Date;
}

export interface PortfolioTrade {
  id: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  amountUsd: number;
  tokenAmount: number;
  executionPrice: number;
  txSignature: string;
  status: string;
  realizedPnl: number;
  createdAt: string;
}

export interface PortfolioApiResponse {
  positions: PortfolioPosition[];
  trades: PortfolioTrade[];
  pnl: { realized: number; unrealized: number };
  cashUsd: number;
  solBalance: number;
}

function numeric(value: NumericInput): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

export function buildPortfolioResponse(input: {
  positions: PortfolioResponsePositionRow[];
  trades: PortfolioResponseTradeRow[];
  markPrices: ReadonlyMap<string, number>;
  cashUsd: number;
  solBalance: number;
}): PortfolioApiResponse {
  const basePositions: PortfolioPosition[] = input.positions.map((position) => {
    const tokenAmount = numeric(position.tokenAmount);
    const entryPrice = numeric(position.entryPrice);
    const pendingSizeUsd = position.orders?.[0]?.sizeUsd;
    return {
      id: position.id,
      ticker: position.ticker,
      tokenAmount,
      avgCost: entryPrice,
      markPrice: entryPrice,
      pnl: 0,
      pendingSizeUsd: pendingSizeUsd == null ? undefined : numeric(pendingSizeUsd),
      state: position.state,
    };
  });

  const { positions, unrealized } = applyMarkPricesToPortfolioPositions(
    basePositions,
    input.markPrices,
  );

  const trades = input.trades.map((trade) => ({
    id: trade.id,
    ticker: trade.ticker,
    side: trade.side as 'BUY' | 'SELL',
    amountUsd: numeric(trade.actualSizeUsd),
    tokenAmount: numeric(trade.filledAmount),
    executionPrice: numeric(trade.executionPrice),
    txSignature: '',
    status: 'CONFIRMED',
    realizedPnl: numeric(trade.realizedPnl),
    createdAt: trade.createdAt.toISOString(),
  }));
  const realized = trades.reduce((acc, trade) => acc + trade.realizedPnl, 0);

  return {
    positions,
    trades,
    pnl: { realized, unrealized },
    cashUsd: input.cashUsd,
    solBalance: input.solBalance,
  };
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
  const positionsValue = holdings.reduce((acc, h) => acc + (h.isPendingBuy ? 0 : h.value), 0);
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
