import assert from 'node:assert/strict';
import test from 'node:test';
import { protectedQueryEnabled } from './protected-query';

test('protected query waits until wallet auth is ready and connected', () => {
  assert.equal(protectedQueryEnabled({ ready: false, connected: false }), false);
  assert.equal(protectedQueryEnabled({ ready: true, connected: false }), false);
  assert.equal(protectedQueryEnabled({ ready: false, connected: true }), false);
  assert.equal(protectedQueryEnabled({ ready: true, connected: true }), true);
});

test('protected query keeps caller-specific disabled state', () => {
  assert.equal(protectedQueryEnabled({ ready: true, connected: true }, false), false);
});
