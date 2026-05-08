import assert from 'node:assert/strict';
import test from 'node:test';
import { BaseAnalysisRefreshGate } from './base-analysis-refresh.js';

const policy = {
  barCloseSeconds: 300,
  materialMovePct: 0.3,
  forceRefreshSeconds: 900,
};

test('BaseAnalysisRefreshGate refreshes initially, then waits while price and bar are unchanged', () => {
  const gate = new BaseAnalysisRefreshGate(policy);

  const first = gate.shouldRefresh({
    assetId: 'AAPLx',
    price: 100,
    publishTimeUnix: 1_800,
    nowUnixSeconds: 1_820,
  });
  assert.equal(first.refresh, true);
  assert.equal(first.reason, 'initial');

  gate.markAnalyzed({
    assetId: 'AAPLx',
    price: 100,
    publishTimeUnix: 1_800,
    nowUnixSeconds: 1_820,
  });

  const repeat = gate.shouldRefresh({
    assetId: 'AAPLx',
    price: 100.2,
    publishTimeUnix: 1_860,
    nowUnixSeconds: 1_880,
  });
  assert.equal(repeat.refresh, false);
  assert.equal(repeat.priceMovePct.toFixed(3), '0.200');
});

test('BaseAnalysisRefreshGate refreshes on material move, bar close, or forced age', () => {
  const materialMoveGate = new BaseAnalysisRefreshGate(policy);
  materialMoveGate.markAnalyzed({
    assetId: 'NVDAx',
    price: 100,
    publishTimeUnix: 1_800,
    nowUnixSeconds: 1_820,
  });
  const materialMove = materialMoveGate.shouldRefresh({
    assetId: 'NVDAx',
    price: 100.31,
    publishTimeUnix: 1_860,
    nowUnixSeconds: 1_880,
  });
  assert.equal(materialMove.refresh, true);
  assert.equal(materialMove.reason, 'material_move');
  assert.equal(materialMove.priceMovePct.toFixed(3), '0.310');
  assert.equal(materialMove.barBucketUnix, 1_800);
  assert.equal(materialMove.ageSeconds, 60);

  const barCloseGate = new BaseAnalysisRefreshGate(policy);
  barCloseGate.markAnalyzed({
    assetId: 'ETH',
    price: 100,
    publishTimeUnix: 1_800,
    nowUnixSeconds: 1_820,
  });
  const barClose = barCloseGate.shouldRefresh({
    assetId: 'ETH',
    price: 100.1,
    publishTimeUnix: 2_101,
    nowUnixSeconds: 2_120,
  });
  assert.equal(barClose.refresh, true);
  assert.equal(barClose.reason, 'bar_close');
  assert.equal(barClose.barBucketUnix, 2_100);

  const forcedGate = new BaseAnalysisRefreshGate(policy);
  forcedGate.markAnalyzed({
    assetId: 'wBTC',
    price: 100,
    publishTimeUnix: 1_800,
    nowUnixSeconds: 1_820,
  });
  const forced = forcedGate.shouldRefresh({
    assetId: 'wBTC',
    price: 100.1,
    publishTimeUnix: 1_860,
    nowUnixSeconds: 2_720,
  });
  assert.equal(forced.refresh, true);
  assert.equal(forced.reason, 'forced');
});
