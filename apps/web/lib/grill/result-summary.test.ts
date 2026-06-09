import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalystVerdict } from './analysis.js';
import { buildGrillResultPresentation, getGrillVerdictCounts } from './result-summary.js';

function opinion(verdict: AnalystVerdict): { verdict: AnalystVerdict } {
  return { verdict };
}

function analysis(opinions: { verdict: AnalystVerdict }[]): {
  opinions: { verdict: AnalystVerdict }[];
} {
  return { opinions };
}

test('Grill result presentation summarizes analyst perspectives without turning them into a final verdict', () => {
  const result = buildGrillResultPresentation(
    analysis([opinion('support'), opinion('challenge'), opinion('reject')]),
  );

  assert.deepEqual(result.counts, {
    total: 3,
    support: 1,
    challenge: 1,
    reject: 1,
  });
  assert.equal(result.summaryLine, '3 analyst views: 1 support, 1 challenge, 1 reject.');
  assert.match(result.guidance, /perspectives/i);
  assert.doesNotMatch(result.guidance, /final verdict/i);
});

test('Grill result presentation uses create-anyway copy when no analyst supports the idea', () => {
  const noSupport = analysis([opinion('challenge'), opinion('reject')]);
  const result = buildGrillResultPresentation(noSupport);

  assert.equal(result.proposalActionLabel, 'Create proposal anyway');
  assert.match(result.proposalBody, /No analyst supports this idea/i);
  assert.match(result.proposalBody, /still create a proposal anyway/i);
});

test('Grill proposal creation uses the normal label when at least one analyst supports the idea', () => {
  const supported = analysis([opinion('support'), opinion('challenge')]);
  const result = buildGrillResultPresentation(supported);

  assert.equal(result.proposalActionLabel, 'Create proposal');
  assert.match(result.proposalBody, /supports? turning this into one proposal/i);
});

test('Grill verdict counts cover empty and repeated verdict sets', () => {
  assert.deepEqual(getGrillVerdictCounts([]), {
    total: 0,
    support: 0,
    challenge: 0,
    reject: 0,
  });

  assert.deepEqual(getGrillVerdictCounts([opinion('challenge'), opinion('challenge')]), {
    total: 2,
    support: 0,
    challenge: 2,
    reject: 0,
  });
});
