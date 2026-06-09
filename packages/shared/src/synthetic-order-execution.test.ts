import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TriggerHitPayloadSchema,
  TriggerWakePayloadSchema,
  type TriggerWakePayload,
} from './types.js';
import {
  buildTriggerUltraSwapPlan,
  closePositionExecutionEvidence,
  executableTriggerDecision,
  pythWakeUpBandHit,
  settlementAmountsForTrigger,
  submittedInputRawForBalance,
  triggerExecutionEvidence,
} from './synthetic-order-execution.js';

const buyPayload: TriggerWakePayload = {
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
  const sellPayload: TriggerWakePayload = {
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

test('trigger:hit payload requires executable quote fields while wake payload does not', () => {
  assert.equal(TriggerWakePayloadSchema.safeParse(buyPayload).success, true);
  assert.equal(TriggerHitPayloadSchema.safeParse(buyPayload).success, false);
  assert.equal(
    TriggerHitPayloadSchema.safeParse({
      ...buyPayload,
      executablePriceUsd: 100,
      executableTokenAmount: 0.25,
      executableUsdValue: 25,
      executablePremiumVsCurrentPricePct: 0,
      executablePremiumVsTriggerPricePct: 0,
    }).success,
    true,
  );
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

test('executableTriggerDecision waits when Ultra BUY price is above the trigger', () => {
  const decision = executableTriggerDecision({
    payload: {
      ...buyPayload,
      triggerPriceUsd: 100,
      currentPriceUsd: 100.4,
      sizeUsd: 25,
    },
    inAmount: '25000000',
    outAmount: '20000000',
    decimals: 8,
  });

  assert.equal(decision.kind, 'waiting');
  assert.equal(decision.reason, 'buy_price_above_trigger');
  assert.equal(decision.executionEvidence.executionPrice, 125);
});

test('pythWakeUpBandHit uses Pyth as a cheap wake-up band', () => {
  assert.equal(
    pythWakeUpBandHit({ kind: 'BUY_TRIGGER', triggerPriceUsd: 100, currentPriceUsd: 100.5 }),
    true,
  );
  assert.equal(
    pythWakeUpBandHit({ kind: 'BUY_TRIGGER', triggerPriceUsd: 100, currentPriceUsd: 100.51 }),
    false,
  );
  assert.equal(
    pythWakeUpBandHit({ kind: 'TAKE_PROFIT', triggerPriceUsd: 100, currentPriceUsd: 99.5 }),
    true,
  );
  assert.equal(
    pythWakeUpBandHit({ kind: 'STOP_LOSS', triggerPriceUsd: 100, currentPriceUsd: 100.5 }),
    true,
  );
});

test('executableTriggerDecision applies TAKE_PROFIT and STOP_LOSS sell conditions', () => {
  const takeProfit = executableTriggerDecision({
    payload: {
      ...buyPayload,
      kind: 'TAKE_PROFIT',
      side: 'SELL',
      triggerPriceUsd: 120,
      tokenAmount: 0.2,
    },
    inAmount: '20000000',
    outAmount: '23800000',
    decimals: 8,
  });
  const stopLoss = executableTriggerDecision({
    payload: {
      ...buyPayload,
      kind: 'STOP_LOSS',
      side: 'SELL',
      triggerPriceUsd: 90,
      tokenAmount: 0.2,
    },
    inAmount: '20000000',
    outAmount: '18200000',
    decimals: 8,
  });

  assert.equal(takeProfit.kind, 'waiting');
  assert.equal(takeProfit.reason, 'take_profit_price_below_trigger');
  assert.equal(takeProfit.executionEvidence.executionPrice, 119);
  assert.equal(stopLoss.kind, 'waiting');
  assert.equal(stopLoss.reason, 'stop_loss_price_above_trigger');
  assert.ok(Math.abs(stopLoss.executionEvidence.executionPrice - 91) < 1e-9);
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
