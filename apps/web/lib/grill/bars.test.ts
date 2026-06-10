import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar } from '@hunch-it/shared';
import { getRequiredGrillBarAssetIds } from './analysis.js';
import { fetchRequiredGrillBars } from './bars.js';

function deferredBars(): {
  promise: Promise<Bar[]>;
  resolve: (bars: Bar[]) => void;
} {
  let resolve!: (bars: Bar[]) => void;
  const promise = new Promise<Bar[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('fetchRequiredGrillBars starts cold daily-bar requests concurrently', async () => {
  const analystIds = [
    'technical',
    'relative_strength',
    'volatility_regime',
    'portfolio_risk_sizer',
    'cross_sectional_ranker',
    'pairs_trading',
  ];
  const requiredAssetIds = getRequiredGrillBarAssetIds('NVDAx', analystIds);
  const pending = new Map<string, ReturnType<typeof deferredBars>>();
  const startedAssetIds: string[] = [];

  const fetchPromise = fetchRequiredGrillBars({
    assetId: 'NVDAx',
    analystIds,
    fetchDailyBars: (assetId) => {
      startedAssetIds.push(assetId);
      const deferred = deferredBars();
      pending.set(assetId, deferred);
      return deferred.promise;
    },
  });

  await Promise.resolve();

  assert.deepEqual(startedAssetIds, requiredAssetIds);

  for (const assetId of requiredAssetIds) {
    pending.get(assetId)?.resolve([
      {
        time: 100,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
      },
    ]);
  }

  const barsByAssetId = await fetchPromise;
  assert.deepEqual([...barsByAssetId.keys()], requiredAssetIds);
});
