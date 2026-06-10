import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST,
  chunkPythLatestPriceFeedIds,
} from './pyth-latest-prices.js';

test('Pyth latest-price feed ids chunk at the public Hermes request budget', () => {
  const ids = Array.from({ length: 205 }, (_, index) => `feed-${index}`);

  assert.equal(PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST, 100);
  assert.deepEqual(
    chunkPythLatestPriceFeedIds(ids).map((chunk) => chunk.length),
    [100, 100, 5],
  );
});
