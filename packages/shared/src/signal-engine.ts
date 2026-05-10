import type { IndicatorSnapshot, SignalAction } from './types.js';

export interface BaseMarketIndicators {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  ma20: number;
  ma50: number;
}

/**
 * Signal Engine boundary object.
 *
 * This is deliberately user-agnostic: no mandate, portfolio, proposal, order,
 * wallet, or execution fields belong here. Adapters can personalize this into
 * proposals, but the Signal Engine owns only market-data interpretation.
 */
export interface BaseMarketAnalysis {
  assetId: string;
  action: SignalAction;
  confidence: number;
  rationale: string;
  what_changed: string;
  why_this_trade: string;
  priceAtAnalysis: number;
  suggestedTriggerPrice?: number;
  suggestedTakeProfitPrice?: number;
  suggestedStopLossPrice?: number;
  suggestedTpPct?: number;
  suggestedSlPct?: number;
  indicators: BaseMarketIndicators;
}

export interface BuildBaseMarketAnalysisInput {
  assetId: string;
  action: SignalAction;
  confidence: number;
  rationale: string;
  priceAtAnalysis: number;
  indicators: BaseMarketIndicators;
  whatChanged?: string;
  whyThisTrade?: string;
  suggestedTriggerPrice?: number;
  suggestedTakeProfitPrice?: number;
  suggestedStopLossPrice?: number;
  suggestedTpPct?: number;
  suggestedSlPct?: number;
}

export function buildBaseMarketAnalysis(
  input: BuildBaseMarketAnalysisInput,
): BaseMarketAnalysis {
  const rationale = input.rationale.trim() || `Market analysis for ${input.assetId}.`;
  return {
    assetId: input.assetId,
    action: input.action,
    confidence: input.confidence,
    rationale,
    what_changed: input.whatChanged?.trim() || rationale,
    why_this_trade: input.whyThisTrade?.trim() || rationale,
    priceAtAnalysis: input.priceAtAnalysis,
    suggestedTriggerPrice: input.suggestedTriggerPrice,
    suggestedTakeProfitPrice: input.suggestedTakeProfitPrice,
    suggestedStopLossPrice: input.suggestedStopLossPrice,
    suggestedTpPct: input.suggestedTpPct,
    suggestedSlPct: input.suggestedSlPct,
    indicators: input.indicators,
  };
}

export function baseMarketIndicatorsToSnapshot(
  indicators: BaseMarketIndicators,
): IndicatorSnapshot {
  return {
    rsi: indicators.rsi,
    macd: indicators.macd,
    ma20: indicators.ma20,
    ma50: indicators.ma50,
  };
}

export function snapshotToBaseMarketIndicators(
  snapshot: IndicatorSnapshot,
  fallbackPrice: number,
): BaseMarketIndicators {
  return {
    rsi: snapshot.rsi ?? 50,
    macd: snapshot.macd ?? { macd: 0, signal: 0, histogram: 0 },
    ma20: snapshot.ma20 ?? fallbackPrice,
    ma50: snapshot.ma50 ?? fallbackPrice,
  };
}
