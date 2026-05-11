import assert from 'node:assert/strict';
import test from 'node:test';
import { awardDeskXp } from './state';
import {
  ROOM_DEV_TOOLS_XP_GRANT,
  addDeskGrowthDevToolsXp,
  createDeskGrowthDevToolsXpFeedback,
  resetDeskGrowthDevToolsState,
} from './dev-tools';
import { deskGrowthFeedbackHandler } from '../notifications/registry';

test('Desk Growth dev tools reset returns the starter room state', () => {
  const funded = awardDeskXp(resetDeskGrowthDevToolsState(), {
    eventId: 'test:seed-xp',
    xp: 500,
  }).state;

  const reset = resetDeskGrowthDevToolsState();

  assert.equal(funded.xpBalance, 500);
  assert.equal(reset.xpBalance, 0);
  assert.equal(reset.analysts.junior.owned, true);
  assert.equal(reset.analysts.quant.owned, false);
  assert.equal(reset.decorations.wallChart, false);
  assert.deepEqual(reset.claimedEventIds, []);
});

test('Desk Growth dev tools add 500 XP to the current room state', () => {
  const state = awardDeskXp(resetDeskGrowthDevToolsState(), {
    eventId: 'test:seed-xp',
    xp: 15,
  }).state;

  const next = addDeskGrowthDevToolsXp(state);

  assert.equal(ROOM_DEV_TOOLS_XP_GRANT, 500);
  assert.equal(next.xpBalance, 515);
  assert.deepEqual(next.claimedEventIds, ['test:seed-xp']);
});

test('Desk Growth dev tools can test the XP gain notification', () => {
  const effects = deskGrowthFeedbackHandler(createDeskGrowthDevToolsXpFeedback());
  const effect = effects[0];

  assert.equal(effects.length, 1);
  assert.ok(effect);
  if (effect.kind !== 'toast') {
    assert.fail(`Expected toast effect, received ${effect.kind}`);
  }

  assert.equal(effect.variant, 'success');
  assert.equal(effect.message, '+500 Desk EXP');
  assert.equal(effect.description, 'Dev tools awarded Desk EXP for room testing.');
  assert.equal(effect.action?.label, 'Open room');
});
