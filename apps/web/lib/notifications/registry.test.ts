import assert from 'node:assert/strict';
import test from 'node:test';
import { deskGrowthFeedbackHandler } from './registry';

test('Desk Growth XP gain feedback uses a local toast only', () => {
  const effects = deskGrowthFeedbackHandler({
    kind: 'xp-awarded',
    xp: 20,
    reason: 'proposal-skip-feedback',
  });

  assert.equal(effects.length, 1);
  const effect = effects[0];
  assert.ok(effect);
  if (effect.kind !== 'toast') {
    assert.fail(`Expected toast effect, received ${effect.kind}`);
  }

  assert.equal(effect.variant, 'success');
  assert.equal(effect.message, '+20 Desk EXP');
  assert.equal(effect.description, 'Feedback logged. Your desk learned from the pass.');
  assert.equal(effect.action?.label, 'Open room');
  assert.equal(effect.durationMs, 6_000);
});
