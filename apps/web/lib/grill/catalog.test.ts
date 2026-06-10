import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_ANALYST_CATALOG,
  DEFAULT_AI_TRADING_TEAM_IDS,
  MAX_AI_TRADING_TEAM_SIZE,
  sanitizeAiTradingTeamIds,
  selectAiAnalysts,
} from './catalog.js';

test('selectAiAnalysts centralizes AI Trading Team selection rules', () => {
  assert.deepEqual(
    selectAiAnalysts(undefined).map((analyst) => analyst.id),
    DEFAULT_AI_TRADING_TEAM_IDS,
  );

  assert.deepEqual(
    selectAiAnalysts(['unknown', 'technical', 'technical', 'relative_strength']).map(
      (analyst) => analyst.id,
    ),
    ['technical', 'relative_strength'],
  );

  assert.deepEqual(
    selectAiAnalysts(AI_ANALYST_CATALOG.map((analyst) => analyst.id)).map((analyst) => analyst.id),
    AI_ANALYST_CATALOG.slice(0, MAX_AI_TRADING_TEAM_SIZE).map((analyst) => analyst.id),
  );

  assert.deepEqual(
    selectAiAnalysts(['unknown']).map((analyst) => analyst.id),
    [AI_ANALYST_CATALOG[0]?.id],
  );
});

test('sanitizeAiTradingTeamIds uses the default team for empty or invalid persisted teams', () => {
  assert.deepEqual(sanitizeAiTradingTeamIds(null), DEFAULT_AI_TRADING_TEAM_IDS);
  assert.deepEqual(sanitizeAiTradingTeamIds(['unknown']), DEFAULT_AI_TRADING_TEAM_IDS);
  assert.deepEqual(sanitizeAiTradingTeamIds(['technical', 'technical']), ['technical']);
});
