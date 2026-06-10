import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST,
  chunkPythLatestPriceFeedIds,
  createPythLatestPriceClient,
} from './pyth-latest-prices.js';

test('Pyth latest-price feed ids chunk at the public Hermes request budget', () => {
  const ids = Array.from({ length: 205 }, (_, index) => `feed-${index}`);

  assert.equal(PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST, 100);
  assert.deepEqual(
    chunkPythLatestPriceFeedIds(ids).map((chunk) => chunk.length),
    [100, 100, 5],
  );
});

test('Pyth latest-price client returns decoded snapshots keyed by AssetId', async () => {
  const requestedUrls: string[] = [];
  const client = createPythLatestPriceClient({
    baseUrl: 'https://hermes.test/',
    cacheMode: 'no-store',
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          parsed: [
            {
              id: 'c9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33',
              price: {
                price: '123456',
                conf: '789',
                expo: -3,
                publish_time: 1_700_000_000,
              },
            },
          ],
        }),
      };
    },
  });

  const snapshots = await client.getLatestPriceSnapshots(['wBTC']);

  assert.equal(requestedUrls.length, 1);
  assert.equal(
    requestedUrls[0],
    'https://hermes.test/v2/updates/price/latest?ids%5B%5D=0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33',
  );
  assert.deepEqual(snapshots.get('wBTC'), {
    ticker: 'wBTC',
    price: 123.456,
    confidence: 0.789,
    publishTime: 1_700_000_000,
  });
});
