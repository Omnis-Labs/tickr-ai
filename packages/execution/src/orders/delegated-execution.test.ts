import assert from 'node:assert/strict';
import test from 'node:test';
import type { TriggerHitPayload } from '@hunch-it/shared';
import {
  tryExecuteDelegatedTriggerOrder,
  type DelegatedExecutionDeps,
} from './delegated-execution.js';

const payload: TriggerHitPayload = {
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

function buildDeps(overrides: Partial<DelegatedExecutionDeps> = {}): DelegatedExecutionDeps {
  return {
    getAssetById: () => ({ decimals: 6 }) as ReturnType<DelegatedExecutionDeps['getAssetById']>,
    resolveDelegatedWalletByAddress: async () =>
      ({
        wallet: { id: 'wallet-1', chain_type: 'solana' },
        delegated: false,
        signerMatched: true,
        authorizationContext: { authorization_private_keys: ['key-1'] },
      }) as Awaited<ReturnType<DelegatedExecutionDeps['resolveDelegatedWalletByAddress']>>,
    prepareInputAmount: async () =>
      ({
        inputMint: 'usdc-mint',
        outputMint: 'mint-aapl',
        amount: '25000000',
        side: 'BUY',
        decimals: 6,
      }) as Awaited<ReturnType<DelegatedExecutionDeps['prepareInputAmount']>>,
    claimOrderExecution: async () => ({
      status: 'success',
      data: {
        orderId: 'order-1',
        positionId: 'position-1',
        orderStatus: 'PENDING',
        positionStatus: 'ENTERING',
      },
    }),
    releaseOrderExecutionClaim: async () => ({
      status: 'success',
      data: {
        orderId: 'order-1',
        positionId: 'position-1',
        orderStatus: 'OPEN',
        positionStatus: 'BUY_PENDING',
      },
    }),
    confirmBuyFill: async () => {
      throw new Error('confirmBuyFill should not be called');
    },
    confirmExitFill: async () => {
      throw new Error('confirmExitFill should not be called');
    },
    requestUltraOrder: async () => ({
      requestId: 'request-1',
      transaction: 'unsigned-tx',
      inAmount: '25000000',
      outAmount: '25000000',
      otherAmountThreshold: '24750000',
      priceImpactPct: '0',
    }),
    getUltraOrderProblem: () => null,
    signDelegatedSolanaTransaction: async () => 'signed-tx',
    executeUltraOrder: async () => {
      throw new Error('network failed after submit');
    },
    ...overrides,
  };
}

test('delegated execution keeps the claim locked when Ultra execute is ambiguous', async () => {
  let releases = 0;
  const deps = buildDeps({
    releaseOrderExecutionClaim: async () => {
      releases += 1;
      throw new Error('release should not be called after execute attempt');
    },
  });

  const outcome = await tryExecuteDelegatedTriggerOrder(
    { userId: 'user-1', walletAddress: 'wallet-1', payload },
    deps,
  );

  if (outcome.kind !== 'broadcastUnknown') {
    assert.fail(`expected broadcastUnknown, got ${outcome.kind}`);
  }
  assert.equal(outcome.orderId, 'order-1');
  assert.equal(outcome.reason, 'delegated_execute_signature_unknown');
  assert.equal(outcome.requestId, 'request-1');
  assert.equal(releases, 0);
});

test('delegated execution releases the claim when signing fails before Ultra execute', async () => {
  let releases = 0;
  const deps = buildDeps({
    signDelegatedSolanaTransaction: async () => {
      throw new Error('privy signer failed');
    },
    releaseOrderExecutionClaim: async () => {
      releases += 1;
      return {
        status: 'success',
        data: {
          orderId: 'order-1',
          positionId: 'position-1',
          orderStatus: 'OPEN',
          positionStatus: 'BUY_PENDING',
        },
      };
    },
  });

  const outcome = await tryExecuteDelegatedTriggerOrder(
    { userId: 'user-1', walletAddress: 'wallet-1', payload },
    deps,
  );

  assert.deepEqual(
    {
      kind: outcome.kind,
      reason: outcome.kind === 'preBroadcastFailed' ? outcome.reason : null,
      released: outcome.kind === 'preBroadcastFailed' ? outcome.released : null,
    },
    {
      kind: 'preBroadcastFailed',
      reason: 'delegated_order_or_sign_runtime_error',
      released: true,
    },
  );
  assert.equal(releases, 1);
});

test('delegated execution settled outcome includes trigger execution evidence', async () => {
  const deps = buildDeps({
    requestUltraOrder: async () => ({
      requestId: 'request-1234567890abcdef',
      transaction: 'unsigned-tx',
      inAmount: '25000000',
      outAmount: '20000000',
      otherAmountThreshold: '19000000',
      priceImpactPct: '0',
    }),
    executeUltraOrder: async () => ({
      status: 'Success',
      signature: 'signature-1234567890abcdef',
    }),
    confirmBuyFill: async () => ({
      status: 'success',
      data: {
        orderId: 'order-1',
        positionId: 'position-1',
        positionStatus: 'ACTIVE',
        tradeId: 'trade-1',
        takeProfitOrderId: 'tp-1',
        stopLossOrderId: 'sl-1',
      },
    }),
  });

  const outcome = await tryExecuteDelegatedTriggerOrder(
    { userId: 'user-1', walletAddress: 'wallet-1', payload },
    deps,
  );

  if (outcome.kind !== 'settled') {
    assert.fail(`expected settled, got ${outcome.kind}`);
  }
  assert.deepEqual(outcome.executionEvidence, {
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
    decimals: 6,
    executionPrice: 1.25,
    tokenAmount: 20,
    usdValue: 25,
    premiumVsCurrentPricePct: -98.75,
    premiumVsTriggerPricePct: -98.75,
    jupiterRequestId: 'requ...cdef',
    txSignature: 'sign...cdef',
  });
});

test('delegated execution releases claim and waits when Ultra BUY price is above trigger', async () => {
  let releases = 0;
  let signs = 0;
  let executes = 0;
  const deps = buildDeps({
    requestUltraOrder: async () => ({
      requestId: 'request-1',
      transaction: 'unsigned-tx',
      inAmount: '25000000',
      outAmount: '200000',
      otherAmountThreshold: '190000',
      priceImpactPct: '0',
    }),
    releaseOrderExecutionClaim: async () => {
      releases += 1;
      return {
        status: 'success',
        data: {
          orderId: 'order-1',
          positionId: 'position-1',
          orderStatus: 'OPEN',
          positionStatus: 'BUY_PENDING',
        },
      };
    },
    signDelegatedSolanaTransaction: async () => {
      signs += 1;
      throw new Error('sign should not run when executable quote waits');
    },
    executeUltraOrder: async () => {
      executes += 1;
      throw new Error('execute should not run when executable quote waits');
    },
  });

  const outcome = await tryExecuteDelegatedTriggerOrder(
    { userId: 'user-1', walletAddress: 'wallet-1', payload },
    deps,
  );

  if (outcome.kind !== 'quoteWaiting') {
    assert.fail(`expected quoteWaiting, got ${outcome.kind}`);
  }
  assert.equal(outcome.reason, 'buy_price_above_trigger');
  assert.equal(outcome.executionEvidence.executionPrice, 125);
  assert.equal(releases, 1);
  assert.equal(signs, 0);
  assert.equal(executes, 0);
});
