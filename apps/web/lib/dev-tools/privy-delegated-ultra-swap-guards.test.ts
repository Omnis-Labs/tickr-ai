import assert from 'node:assert/strict';
import test from 'node:test';
import type { UltraOrderResponse } from '@/lib/jupiter';
import { getUltraOrderProblem } from './privy-delegated-ultra-swap-guards';

function ultraOrder(overrides: Partial<UltraOrderResponse>): UltraOrderResponse {
  return {
    requestId: 'request-1',
    transaction: 'AQID',
    inAmount: '5000000',
    outAmount: '100',
    otherAmountThreshold: '99',
    priceImpactPct: '0',
    ...overrides,
  };
}

test('delegated Ultra swap guard maps empty insufficient-funds transaction to a clear error', () => {
  const problem = getUltraOrderProblem(
    ultraOrder({
      transaction: '',
      error: 'Insufficient funds',
      errorCode: 'INSUFFICIENT_FUNDS',
    }),
  );

  assert.equal(problem?.code, 'insufficient_funds');
  assert.equal(problem?.message, 'insufficient_funds');
  assert.equal(problem?.detail.transactionLength, 0);
});

test('delegated Ultra swap guard accepts a non-empty transaction without Ultra errors', () => {
  assert.equal(getUltraOrderProblem(ultraOrder({})), null);
});
