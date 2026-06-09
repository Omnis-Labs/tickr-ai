import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalystOpinion, AnalystVerdict, GrillAnalysisResult } from './analysis.js';
import {
  buildGrillProposalAnalysis,
  buildGrillProposalRequest,
  canCreateGrillProposal,
} from './proposal-policy.js';

function opinion(input: {
  analystId: string;
  verdict: AnalystVerdict;
  confidence: number;
  thesis: string;
}): AnalystOpinion {
  return {
    analystId: input.analystId,
    analystName: `${input.analystId} analyst`,
    originTask: 'Task view',
    verdict: input.verdict,
    confidence: input.confidence,
    thesis: input.thesis,
    whyNow: `${input.analystId} timing`,
    setupEntry: `${input.analystId} entry`,
    riskProtection: `${input.analystId} protection`,
    invalidation: `${input.analystId} invalidation`,
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

test('Grill proposal policy allows creating a proposal from any completed vetting result', () => {
  const noSupport = analysis([
    opinion({
      analystId: 'volatility',
      verdict: 'reject',
      confidence: 0.81,
      thesis: 'Volatility rejects a fresh long.',
    }),
    opinion({
      analystId: 'seasonality',
      verdict: 'challenge',
      confidence: 0.66,
      thesis: 'Seasonality only challenges the idea.',
    }),
  ]);

  assert.equal(canCreateGrillProposal(noSupport, null), true);
  assert.equal(canCreateGrillProposal(noSupport, 'proposal'), false);
  assert.equal(canCreateGrillProposal(null, null), false);
});

test('Grill proposal analysis can be created anyway when no Analyst Opinion supports the idea', () => {
  const result = analysis([
    opinion({
      analystId: 'volatility',
      verdict: 'reject',
      confidence: 0.81,
      thesis: 'Volatility rejects a fresh long.',
    }),
    opinion({
      analystId: 'seasonality',
      verdict: 'challenge',
      confidence: 0.66,
      thesis: 'Seasonality only challenges the idea.',
    }),
  ]);

  const proposalAnalysis = buildGrillProposalAnalysis({ result, latestPrice: 123.45 });

  assert.ok(proposalAnalysis);
  assert.equal(proposalAnalysis.assetId, 'NVDAx');
  assert.equal(proposalAnalysis.action, 'BUY');
  assert.equal(proposalAnalysis.priceAtAnalysis, 123.45);
  assert.match(proposalAnalysis.rationale, /no supporting Analyst Opinion/i);
  assert.match(proposalAnalysis.rationale, /Volatility rejects a fresh long/i);
  assert.match(proposalAnalysis.why_this_trade, /Create-anyway review/i);
});

test('Grill proposal analysis prefers a supporting Analyst Opinion over higher-confidence cautions', () => {
  const result = analysis([
    opinion({
      analystId: 'volatility',
      verdict: 'reject',
      confidence: 0.9,
      thesis: 'Volatility rejects a fresh long.',
    }),
    opinion({
      analystId: 'technical',
      verdict: 'support',
      confidence: 0.72,
      thesis: 'Technical tape supports the setup.',
    }),
  ]);

  const proposalAnalysis = buildGrillProposalAnalysis({ result, latestPrice: 123.45 });

  assert.ok(proposalAnalysis);
  assert.match(proposalAnalysis.rationale, /Technical tape supports the setup/i);
  assert.doesNotMatch(proposalAnalysis.rationale, /no supporting Analyst Opinion/i);
});

test('Grill proposal request uses the vetted result rather than mutable form controls', () => {
  const request = buildGrillProposalRequest(
    analysis([
      opinion({
        analystId: 'technical',
        verdict: 'support',
        confidence: 0.72,
        thesis: 'Technical tape supports the setup.',
      }),
      opinion({
        analystId: 'volatility',
        verdict: 'challenge',
        confidence: 0.68,
        thesis: 'Volatility challenges the setup.',
      }),
    ]),
  );

  assert.deepEqual(request, {
    assetId: 'NVDAx',
    idea: 'Buy NVDAx if the tape confirms the move.',
    analystIds: ['technical', 'volatility'],
  });
});
