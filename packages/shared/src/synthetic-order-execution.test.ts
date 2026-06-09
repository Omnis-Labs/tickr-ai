import assert from 'node:assert/strict';
import test from 'node:test';
import type { TriggerHitPayload } from './types.js';
import {
  buildTriggerUltraSwapPlan,
  closePositionExecutionEvidence,
  settlementAmountsForTrigger,
  submittedInputRawForBalance,
  triggerExecutionEvidence,
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

test('triggerExecutionEvidence records BUY mark premium and redacted execution identifiers', () => {
  assert.deepEqual(
    triggerExecutionEvidence({
      payload: buyPayload,
      inAmount: '25000000',
      outAmount: '20000000',
      decimals: 8,
      jupiterRequestId: 'request-1234567890abcdef',
      txSignature: 'signature-1234567890abcdef',
    }),
    {
      orderId: 'order-1',
      positionId: 'position-1',
      ticker: 'AAPLx',
      kind: 'BUY_TRIGGER',
      side: 'BUY',
      triggerPriceUsd: 100,
      currentPriceUsd: 100,
      sizeUsd: 25,
      ultraInAmount: '25000000',
      ultraOutAmount: '20000000',
      decimals: 8,
      executionPrice: 125,
      tokenAmount: 0.2,
      usdValue: 25,
      premiumVsCurrentPricePct: 25,
      premiumVsTriggerPricePct: 25,
      jupiterRequestId: 'requ...cdef',
      txSignature: 'sign...cdef',
    },
  );
});

test('closePositionExecutionEvidence records position-scoped sell amount', () => {
  assert.deepEqual(
    closePositionExecutionEvidence({
      positionId: 'position-1',
      ticker: 'SPYx',
      decimals: 8,
      requestedTokenAmount: 0.2,
      requestedRawAmount: '20000000',
      walletRawAmount: '40000000',
      submittedRawAmount: '20000000',
      ultraInAmount: '20000000',
      ultraOutAmount: '24000000',
      jupiterRequestId: 'request-1234567890abcdef',
      txSignature: 'signature-1234567890abcdef',
      closeOrderId: 'close-order-1234567890abcdef',
      cancelledExitOrderIds: ['take-profit-1234567890abcdef', 'stop-loss-1234567890abcdef'],
    }),
    {
      positionId: 'position-1',
      ticker: 'SPYx',
      positionScope: 'position_token_amount',
      decimals: 8,
      requestedTokenAmount: 0.2,
      requestedRawAmount: '20000000',
      walletRawAmount: '40000000',
      submittedRawAmount: '20000000',
      ultraInAmount: '20000000',
      ultraOutAmount: '24000000',
      submittedTokenAmount: 0.2,
      tokenAmount: 0.2,
      usdValue: 24,
      executionPrice: 120,
      jupiterRequestId: 'requ...cdef',
      txSignature: 'sign...cdef',
      closeOrderId: 'clos...cdef',
      cancelledExitOrderIds: ['take...cdef', 'stop...cdef'],
    },
  );
});
