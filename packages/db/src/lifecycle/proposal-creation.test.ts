import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBaseMarketAnalysis } from '@hunch-it/shared';
import {
  buildBuyProposalCreateData,
  buildCreateBuyProposalForUserInput,
} from './proposal-creation.js';

test('ProposalCreation adapter input accepts DB mandates and ws-server position-impact aliases', () => {
  const input = buildCreateBuyProposalForUserInput({
    userId: 'user-1',
    analysis: buildBaseMarketAnalysis({
      assetId: 'AAPLx',
      action: 'BUY',
      confidence: 0.82,
      rationale: 'Momentum improved after a controlled pullback.',
      whatChanged: 'Price reclaimed the 20 day average.',
      whyThisTrade: 'Risk is close and upside is defined.',
      priceAtAnalysis: 100,
      indicators: {
        rsi: 58,
        macd: { macd: 1.2, signal: 0.7, histogram: 0.5 },
        ma20: 98,
        ma50: 96,
      },
    }),
    mandate: {
      holdingPeriod: '1-2 weeks',
      maxTradeSize: { toNumber: () => 250 },
      maxDrawdown: { toNumber: () => 0.08 },
    },
    positionImpact: {
      totalUsd: 1000,
      cashUsd: 200,
      tickerExposureUsd: 50,
      sectorExposureUsd: 100,
    },
    origin: 'SIGNAL_ENGINE',
  });

  const data = buildBuyProposalCreateData(input);

  assert.ok(data);
  assert.equal(data.suggestedSizeUsd, 40);
  assert.deepEqual(data.positionImpact, {
    weight_before: 0.05,
    weight_after: 0.09,
    cash_after: 160,
    sector_before: 0.1,
    sector_after: 0.14,
  });
  const reasoning = data.reasoning as { why_fits_mandate: string };
  assert.match(reasoning.why_fits_mandate, /8% drawdown tolerance/);
});
