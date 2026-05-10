import assert from 'node:assert/strict';
import test from 'node:test';
import type { TriggerHitPayload } from './types.js';
import {
  buildTriggerUltraSwapPlan,
  settlementAmountsForTrigger,
  submittedInputRawForBalance,
} from './synthetic-order-execution.js';

const buyPayload: TriggerHitPayload = {
  orderId: 'order-1',
  positionId: 'position-1',
  ticker: 'AAPLx',
  mint: 'mint-aapl',
  kind: 'BUY_TRIGGER',
  side: 'BUY',
  triggerPriceUsd: 100,
  currentPriceUsd: 100,
  sizeUsd: 25,
  tokenAmount: null,
};

test('buildTriggerUltraSwapPlan builds BUY plans in USDC raw units', () => {
  assert.deepEqual(buildTriggerUltraSwapPlan(buyPayload, 8), {
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'mint-aapl',
    amount: '25000000',
    side: 'BUY',
    decimals: 8,
  });
});

test('buildTriggerUltraSwapPlan builds exact-token SELL plans', () => {
  const sellPayload: TriggerHitPayload = {
    ...buyPayload,
    kind: 'TAKE_PROFIT',
    side: 'SELL',
    sizeUsd: 31.5,
    tokenAmount: 0.125,
  };

  assert.deepEqual(buildTriggerUltraSwapPlan(sellPayload, 8), {
    inputMint: 'mint-aapl',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: '12500000',
    side: 'SELL',
    decimals: 8,
  });
});

test('submittedInputRawForBalance caps SELL but requires full BUY funding', () => {
  assert.equal(
    submittedInputRawForBalance({ side: 'SELL', requestedRaw: 100n, walletRaw: 40n }),
    40n,
  );
  assert.equal(
    submittedInputRawForBalance({ side: 'BUY', requestedRaw: 100n, walletRaw: 40n }),
    null,
  );
});

test('settlementAmountsForTrigger derives execution price from Ultra amounts', () => {
  assert.deepEqual(
    settlementAmountsForTrigger({
      payload: buyPayload,
      inAmount: '25000000',
      outAmount: '20000000',
      decimals: 8,
    }),
    {
      executionPrice: 125,
      tokenAmount: 0.2,
      usdValue: 25,
    },
  );
});
