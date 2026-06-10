export const PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST = 100;

export function chunkPythLatestPriceFeedIds<T>(ids: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < ids.length; index += PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST) {
    chunks.push(ids.slice(index, index + PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST));
  }
  return chunks;
}
