import { derivePortfolioSummary, type PortfolioSummaryInput } from './summary';

type AuthedFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface PortfolioSummaryEvidence {
  cashUsd: number;
  activePositions: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionsValue: number;
  totalValue: number;
}

export function portfolioSummaryEvidence(
  input: PortfolioSummaryInput | null | undefined,
): PortfolioSummaryEvidence {
  const summary = derivePortfolioSummary(input);
  return {
    cashUsd: summary.cashUsd,
    activePositions: summary.closablePositions.length,
    realizedPnl: summary.realizedPnl,
    unrealizedPnl: summary.unrealizedPnl,
    totalPnl: summary.totalPnl,
    positionsValue: summary.positionsValue,
    totalValue: summary.totalValue,
  };
}

export async function readPortfolioSummaryEvidence(
  authedFetch: AuthedFetch,
): Promise<PortfolioSummaryEvidence | { error: string }> {
  try {
    const response = await authedFetch('/api/portfolio?freshBalances=1');
    if (!response.ok) return { error: `portfolio ${response.status}` };
    const data = (await response.json().catch(() => null)) as PortfolioSummaryInput | null;
    return portfolioSummaryEvidence(data);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
