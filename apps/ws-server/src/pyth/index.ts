/**
 * Real Pyth Hermes integration. Replaces the Phase 1 sinusoidal stub.
 *
 * Shared Pyth Latest Price owns feed lookup, request chunking, and Hermes
 * price/exponent decoding. ws-server only supplies env + fetch.
 */

import {
  createPythLatestPriceClient,
  evaluateSignalDataFreshness,
  getSignalAssets,
  type PriceSnapshot,
  type PythLatestPriceFetch,
  type SignalDataFreshnessVerdict,
} from '@hunch-it/shared';
import { env } from '../env.js';

const latestPrices = createPythLatestPriceClient({
  baseUrl: env.PYTH_HERMES_URL,
  fetchImpl: fetch as unknown as PythLatestPriceFetch,
  cacheMode: 'no-store',
});

/**
 * Fetches the latest snapshot for each given asset id. Throws if any feed ID
 * is unset (constants not yet populated). Caller can catch + skip individual
 * tickers; we'd rather crash early than emit signals on missing data.
 */
export async function getLatestPrices(
  assetIds: readonly string[] = getSignalAssets().map((asset) => asset.assetId),
): Promise<Map<string, PriceSnapshot>> {
  return latestPrices.getLatestPriceSnapshots(assetIds);
}

/** Convenience for single-ticker callers. */
export async function getLatestPrice(assetId: string): Promise<PriceSnapshot | null> {
  const m = await getLatestPrices([assetId]);
  return m.get(assetId) ?? null;
}

export type FreshnessVerdict = SignalDataFreshnessVerdict;
export const evaluateFreshness = evaluateSignalDataFreshness;
