import assert from 'node:assert/strict';
import test from 'node:test';
import {
  awardDeskXp,
  buyDeskDecoration,
  createInitialDeskGrowthState,
  levelUpAnalyst,
  normalizeDeskGrowthState,
  recruitQuantAnalyst,
} from './state';

test('Desk EXP awards proposal review XP once per proposal', () => {
  const first = awardDeskXp(createInitialDeskGrowthState(), {
    eventId: 'proposal-review:proposal-1',
    xp: 10,
  });
  const second = awardDeskXp(first.state, {
    eventId: 'proposal-review:proposal-1',
    xp: 10,
  });

  assert.equal(first.awarded, true);
  assert.equal(first.state.xpBalance, 10);
  assert.equal(second.awarded, false);
  assert.equal(second.state.xpBalance, 10);
});

test('Desk EXP can be spent to recruit Quant Analyst once', () => {
  const funded = awardDeskXp(createInitialDeskGrowthState(), {
    eventId: 'proposal-skip:proposal-1',
    xp: 20,
  }).state;
  const recruited = recruitQuantAnalyst(funded);
  const duplicate = recruitQuantAnalyst(recruited.state);

  assert.equal(recruited.recruited, true);
  assert.equal(recruited.state.xpBalance, 0);
  assert.equal(recruited.state.analysts.quant.owned, true);
  assert.equal(duplicate.recruited, false);
  assert.equal(duplicate.state.xpBalance, 0);
});

test('Analyst levels spend Desk EXP and cap at level 4', () => {
  const funded = awardDeskXp(createInitialDeskGrowthState(), {
    eventId: 'proposal-accept:proposal-1',
    xp: 200,
  }).state;
  const level2 = levelUpAnalyst(funded, 'junior');
  const level3 = levelUpAnalyst(level2.state, 'junior');
  const level4 = levelUpAnalyst(level3.state, 'junior');
  const capped = levelUpAnalyst(level4.state, 'junior');

  assert.equal(level2.leveled, true);
  assert.equal(level2.state.analysts.junior.level, 2);
  assert.equal(level4.state.analysts.junior.level, 4);
  assert.equal(level4.state.xpBalance, 80);
  assert.equal(capped.leveled, false);
  assert.equal(capped.state.xpBalance, 80);
});

test('Desk Decorations spend EXP once and persist as owned', () => {
  const funded = awardDeskXp(createInitialDeskGrowthState(), {
    eventId: 'proposal-accept:proposal-1',
    xp: 30,
  }).state;
  const bought = buyDeskDecoration(funded, 'wallChart');
  const duplicate = buyDeskDecoration(bought.state, 'wallChart');

  assert.equal(bought.bought, true);
  assert.equal(bought.state.xpBalance, 5);
  assert.equal(bought.state.decorations.wallChart, true);
  assert.equal(duplicate.bought, false);
  assert.equal(duplicate.state.xpBalance, 5);
});

test('Desk Growth persistence normalizes partial local state with defaults', () => {
  const state = normalizeDeskGrowthState({
    xpBalance: 15,
    analysts: {
      junior: { owned: true, level: 2 },
    },
  });

  assert.equal(state.xpBalance, 15);
  assert.equal(state.analysts.junior.level, 2);
  assert.equal(state.analysts.quant.owned, false);
  assert.equal(state.decorations.deskDog, false);
  assert.deepEqual(state.claimedEventIds, []);
});
