import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHoldingStateForDisplay } from './holding-labels';

test('portfolio holding state labels use user-facing trading language', () => {
  assert.equal(formatHoldingStateForDisplay('BUY_PENDING'), 'Waiting for entry');
  assert.equal(formatHoldingStateForDisplay('ENTERING'), 'Entering');
  assert.equal(formatHoldingStateForDisplay('CLOSING'), 'Closing');
  assert.equal(formatHoldingStateForDisplay('CLOSED'), 'Closed');
  assert.equal(formatHoldingStateForDisplay('ACTIVE'), 'Active');
});
