import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalystOpinion, AnalystVerdict, GrillAnalysisResult } from './analysis.js';
import {
  buildGrillResultPresentation,
  canCreateGrillProposal,
  getGrillVerdictCounts,
} from './result-summary.js';

function opinion(verdict: AnalystVerdict, analystId: string = verdict): AnalystOpinion {
  return {
    analystId,
    analystName: `${verdict} analyst`,
    originTask: 'Task view',
    verdict,
    confidence: 0.72,
    thesis: `${verdict} thesis`,
    whyNow: `${verdict} timing`,
    setupEntry: `${verdict} entry`,
    riskProtection: `${verdict} protection`,
    invalidation: `${verdict} invalidation`,
    evidence: [],
    backtest: {
      totalReturnPct: 0,
      benchmarkReturnPct: 0,
      excessReturnPct: 0,
      maxDrawdownPct: 0,
      nTrades: 0,
      exposurePct: 0,
    },
    sourceFiles: [],
    indicators: {
      rsi: 50,
      macd: { macd: 0, signal: 0, histogram: 0 },
      ma20: 100,
      ma50: 100,
    },
  };
}

function analysis(opinions: AnalystOpinion[]): GrillAnalysisResult {
  return {
    assetId: 'NVDAx',
    idea: 'Buy NVDAx if the tape confirms the move.',
    asOf: '2026-06-09T00:00:00.000Z',
    opinions,
  };
}

test('Grill result presentation summarizes analyst perspectives without turning them into a final verdict', () => {
  const result = buildGrillResultPresentation(
    analysis([
      opinion('support', 'technical'),
      opinion('challenge', 'relative-strength'),
      opinion('reject', 'volatility'),
    ]),
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

test('Grill proposal creation stays available when no analyst supports the idea', () => {
  const noSupport = analysis([opinion('challenge', 'relative-strength'), opinion('reject')]);
  const result = buildGrillResultPresentation(noSupport);

  assert.equal(canCreateGrillProposal(noSupport, null), true);
  assert.equal(canCreateGrillProposal(noSupport, 'proposal'), false);
  assert.equal(result.proposalActionLabel, 'Create proposal anyway');
  assert.match(result.proposalBody, /No analyst supports this idea/i);
  assert.match(result.proposalBody, /still create a proposal anyway/i);
});

test('Grill proposal creation uses the normal label when at least one analyst supports the idea', () => {
  const supported = analysis([opinion('support'), opinion('challenge')]);
  const result = buildGrillResultPresentation(supported);

  assert.equal(canCreateGrillProposal(supported, null), true);
  assert.equal(canCreateGrillProposal(null, null), false);
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
