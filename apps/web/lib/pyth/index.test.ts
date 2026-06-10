import assert from 'node:assert/strict';
import test from 'node:test';
import { getSignalAssets } from '@hunch-it/shared';
import { PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST, getCurrentPriceSnapshots } from './index.js';

test('Current Hunch latest-price universe fits in one Hermes request', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ parsed: [] }),
    } as Response;
  }) as typeof fetch;

  try {
    await getCurrentPriceSnapshots(getSignalAssets().map((asset) => asset.assetId));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestedUrls.length, 1);
  const ids = new URL(requestedUrls[0]!).searchParams.getAll('ids[]');
  assert.ok(ids.length > 0);
  assert.ok(ids.length <= PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST);
});
