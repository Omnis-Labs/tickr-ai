import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBuyProposalCreateData } from './proposal-creation.js';
import { suggestBuyProposalSizeUsd } from './proposal-sizing.js';

const analysis = {
  assetId: 'NVDAx',
  action: 'BUY',
  confidence: 0.8,
  rationale: 'RSI recovery with bullish MACD.',
  what_changed: 'Momentum improved.',
  why_this_trade: 'The setup has a favorable trigger.',
  priceAtAnalysis: 100,
  indicators: {
    rsi: 42,
    macd: { macd: 1, signal: 0.5, histogram: 0.5 },
    ma20: 98,
    ma50: 95,
  },
} as const;

test('suggestBuyProposalSizeUsd uses wallet-aware Proposal Lab sizing', () => {
  assert.equal(suggestBuyProposalSizeUsd({ availableUsdc: 40, maxTradeSizeUsd: 500 }), 10);
  assert.equal(suggestBuyProposalSizeUsd({ availableUsdc: 1000, maxTradeSizeUsd: 100 }), 100);
  assert.equal(suggestBuyProposalSizeUsd({ availableUsdc: 2.25, maxTradeSizeUsd: 500 }), 2.25);
  assert.equal(suggestBuyProposalSizeUsd({ availableUsdc: 0, maxTradeSizeUsd: 500 }), 0);
  assert.equal(suggestBuyProposalSizeUsd({ availableUsdc: 500, maxTradeSizeUsd: 0 }), 0);
});

test('ProposalCreation defaults suggested size from cash balance and max trade size', () => {
  const data = buildBuyProposalCreateData({
    userId: 'user-1',
    analysis,
    mandate: {
      holdingPeriod: '1-2 weeks',
      maxTradeSizeUsd: 500,
      maxDrawdown: 0.05,
    },
    positionImpact: {
      totalUsd: 40,
      cashUsd: 40,
      assetExposureUsd: 0,
      verticalExposureUsd: 0,
    },
    now: new Date('2026-05-09T00:00:00.000Z'),
  });

  assert.ok(data);
  assert.equal(data.suggestedSizeUsd, 10);
  assert.deepEqual(data.positionImpact, {
    weight_before: 0,
    weight_after: 0.25,
    cash_after: 30,
    sector_before: 0,
    sector_after: 0.25,
  });
  const reasoning = data.reasoning as { why_fits_mandate: string };
  assert.match(reasoning.why_fits_mandate, /40\.00 USDC balance/);
});

test('ProposalCreation returns null when no USDC can size the proposal', () => {
  const data = buildBuyProposalCreateData({
    userId: 'user-1',
    analysis,
    mandate: {
      holdingPeriod: '1-2 weeks',
      maxTradeSizeUsd: 500,
      maxDrawdown: 0.05,
    },
    positionImpact: {
      totalUsd: 0,
      cashUsd: 0,
      assetExposureUsd: 0,
      verticalExposureUsd: 0,
    },
  });

  assert.equal(data, null);
});
