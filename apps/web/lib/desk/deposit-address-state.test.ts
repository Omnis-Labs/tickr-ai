import assert from 'node:assert/strict';
import test from 'node:test';
import { depositAddressState } from './deposit-address-state';

test('deposit address stays loading until wallet readiness is known', () => {
  assert.equal(
    depositAddressState({
      ready: false,
      connected: false,
      address: null,
    }),
    'loading',
  );
});

test('deposit address shows the wallet address once connected', () => {
  assert.equal(
    depositAddressState({
      ready: true,
      connected: true,
      address: '2L6wCA',
    }),
    'address',
  );
});

test('deposit address shows signed-out copy only after readiness is known', () => {
  assert.equal(
    depositAddressState({
      ready: true,
      connected: false,
      address: null,
    }),
    'signed-out',
  );
});
