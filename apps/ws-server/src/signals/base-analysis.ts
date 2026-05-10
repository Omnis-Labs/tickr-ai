import {
  SIGNAL_TTL_DEFAULT,
  buildBaseMarketAnalysis,
  type BaseMarketAnalysis,
} from '@hunch-it/shared';
import { getHistoricalBars } from '../pyth/benchmarks.js';
import { evaluateFreshness, getLatestPrice } from '../pyth/index.js';
import { env } from '../env.js';
import { BaseAnalysisRefreshGate } from './base-analysis-refresh.js';
import { computeIndicators } from './indicators.js';
import { generateLlmSignal } from './llm.js';

export interface GeneratedBaseMarketAnalysis {
  analysis: BaseMarketAnalysis;
  ttlSeconds: number;
  degraded: boolean;
}

const refreshGate = new BaseAnalysisRefreshGate({
  barCloseSeconds: env.BASE_ANALYSIS_BAR_CLOSE_SECONDS,
  materialMovePct: env.BASE_ANALYSIS_MATERIAL_MOVE_PCT,
  forceRefreshSeconds: env.BASE_ANALYSIS_FORCE_REFRESH_SECONDS,
});

/**
 * Signal Engine core: asset market data in, Base Market Analysis out.
 *
 * Keep this module independent from users, mandates, proposals, orders,
 * sockets, and persistence so the engine can evolve without touching the
 * rest of the product surface.
 */
export async function generateBaseMarketAnalysis(
  assetId: string,
): Promise<GeneratedBaseMarketAnalysis | null> {
  const snap = await getLatestPrice(assetId);
  if (!snap) {
    console.warn(`[signal-engine] ${assetId} no Pyth snapshot`);
    return null;
  }
  const verdict = evaluateFreshness(snap);
  if (!verdict.fresh) {
    console.log(`[signal-engine] ${assetId} skipped: ${verdict.reason}`);
    return null;
  }

  const refresh = refreshGate.shouldRefresh({
    assetId,
    price: snap.price,
    publishTimeUnix: snap.publishTime,
  });
  if (!refresh.refresh) {
    console.log(
      `[signal-engine] ${assetId} analysis unchanged: ` +
        `move=${refresh.priceMovePct.toFixed(3)}% age=${refresh.ageSeconds ?? 0}s`,
    );
    return null;
  }

  const bars = await getHistoricalBars(assetId, '5', 24);
  if (bars.length < 50) {
    console.warn(`[signal-engine] ${assetId} insufficient bars (${bars.length} < 50)`);
    return null;
  }

  const indicators = await computeIndicators(bars);
  const llm = await generateLlmSignal({
    assetId,
    currentPrice: snap.price,
    bars,
    indicators,
  });

  const buyDefaults =
    llm.signal.action === 'BUY'
      ? {
          suggestedTpPct: 0.04,
          suggestedSlPct: 0.025,
        }
      : {};

  refreshGate.markAnalyzed({
    assetId,
    price: snap.price,
    publishTimeUnix: snap.publishTime,
  });
  console.log(
    `[signal-engine] ${assetId} analyzed reason=${refresh.reason} ` +
      `move=${refresh.priceMovePct.toFixed(3)}%`,
  );

  return {
    analysis: buildBaseMarketAnalysis({
      assetId,
      action: llm.signal.action,
      confidence: llm.signal.confidence,
      rationale: llm.signal.rationale,
      priceAtAnalysis: snap.price,
      indicators: {
        rsi: indicators.rsi14,
        macd: indicators.macd,
        ma20: indicators.ma20,
        ma50: indicators.ma50,
      },
      ...buyDefaults,
    }),
    ttlSeconds: llm.signal.ttl_seconds ?? SIGNAL_TTL_DEFAULT,
    degraded: llm.degraded,
  };
}
