import assert from 'node:assert/strict';
import test from 'node:test';
import { executedNotionalUsd } from './position-lifecycle';

test('exit fill notional uses actual execution price, not planned TP/SL order size', () => {
  const plannedTakeProfitNotional = 5.24;
  const actual = executedNotionalUsd({
    executionPrice: 212.02841981,
    tokenAmount: 0.02340058,
  });

  assert.equal(actual.toFixed(2), '4.96');
  assert.notEqual(actual.toFixed(2), plannedTakeProfitNotional.toFixed(2));
});
