import assert from 'node:assert/strict';
import test from 'node:test';
import { submittedInputRawForBalance } from './privy-delegated-ultra-swap-amounts';

test('delegated Ultra sell caps submitted amount to available wallet balance', () => {
  const submitted = submittedInputRawForBalance({
    side: 'SELL',
    requestedRaw: 739757n,
    walletRaw: 739628n,
  });

  assert.equal(submitted, 739628n);
});

test('delegated Ultra buy requires the requested raw input', () => {
  const submitted = submittedInputRawForBalance({
    side: 'BUY',
    requestedRaw: 25_000_000n,
    walletRaw: 24_999_999n,
  });

  assert.equal(submitted, null);
});

test('delegated Ultra sell still rejects zero balance', () => {
  const submitted = submittedInputRawForBalance({
    side: 'SELL',
    requestedRaw: 739757n,
    walletRaw: 0n,
  });

  assert.equal(submitted, null);
});
