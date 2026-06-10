// Server-side Pyth helper for the web app. Mirrors ws-server's getLatestPrices
// but kept self-contained so the web app doesn't depend on ws-server modules.

import {
  PYTH_HERMES_DEFAULT_URL,
  PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST,
  chunkPythLatestPriceFeedIds,
  createPythLatestPriceClient,
  type PythLatestPriceFetch,
  type PriceSnapshot,
} from '@hunch-it/shared';

const HERMES = process.env.PYTH_HERMES_URL ?? PYTH_HERMES_DEFAULT_URL;
const latestPrices = createPythLatestPriceClient({
  baseUrl: HERMES,
  fetchImpl: fetch as unknown as PythLatestPriceFetch,
  cacheMode: 'no-store',
});
export { PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST, chunkPythLatestPriceFeedIds };

/**
 * Fetches the latest spot price for each tradable asset id via Hermes REST.
 * Returns prices keyed by asset id (e.g. "AAPLx", "wBTC").
 * Throws if any feed id is empty (constants not yet populated).
 */
export async function getCurrentPrices(assetIds: readonly string[]): Promise<Map<string, number>> {
  return latestPrices.getLatestPrices(assetIds);
}

export async function getCurrentPriceSnapshots(
  assetIds: readonly string[],
): Promise<Map<string, PriceSnapshot>> {
  return latestPrices.getLatestPriceSnapshots(assetIds);
}
