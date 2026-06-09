import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTriggerHitSocketPayload } from './socket-payloads';

const basePayload = {
  orderId: 'order-1',
  positionId: 'position-1',
  ticker: 'SPYx',
  mint: 'mint-spyx',
  kind: 'BUY_TRIGGER',
  side: 'BUY',
  triggerPriceUsd: 100,
  currentPriceUsd: 100,
  sizeUsd: 25,
  tokenAmount: null,
};

test('parseTriggerHitSocketPayload rejects trigger hits without executable quote fields', () => {
  assert.equal(parseTriggerHitSocketPayload(basePayload), null);
});

test('parseTriggerHitSocketPayload accepts executable trigger hits', () => {
  const parsed = parseTriggerHitSocketPayload({
    ...basePayload,
    executablePriceUsd: 99.5,
    executableTokenAmount: 0.251256,
    executableUsdValue: 25,
    executablePremiumVsCurrentPricePct: -0.5,
    executablePremiumVsTriggerPricePct: -0.5,
  });

  assert.equal(parsed?.executablePriceUsd, 99.5);
});
