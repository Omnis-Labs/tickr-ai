import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProposalForClient } from './normalize';

const baseProposal = {
  id: 'proposal-1',
  userId: 'user-1',
  ticker: 'QQQx',
  action: 'BUY',
  suggestedSizeUsd: '5.00',
  suggestedTriggerPrice: '715.26',
  suggestedTakeProfitPrice: '743.87',
  suggestedStopLossPrice: '697.38',
  rationale: 'RSI at 24.07 indicates oversold conditions.',
  reasoning: {
    what_changed: 'RSI at 24.07 indicates oversold conditions.',
    why_this_trade: 'Expect a mean reversion bounce.',
    why_fits_mandate: 'Size $5.00 is based on your $19.23 USDC balance.',
  },
  positionImpact: {
    weight_before: '0',
    weight_after: '0.26',
    cash_after: '14.23',
    sector_before: '0',
    sector_after: '0.26',
  },
  confidence: '0.72',
  priceAtProposal: '717.05',
  indicators: { rsi: 24.07, ma20: 715.26, ma50: 715.14 },
  thesisTags: ['rsi_oversold'],
  origin: 'SIGNAL_ENGINE',
  status: 'ACTIVE',
  expiresAt: '2026-05-09T12:00:00.000Z',
  createdAt: '2026-05-09T10:30:00.000Z',
};

test('normalizeProposalForClient coerces socket Decimal strings into UI numbers', () => {
  const proposal = normalizeProposalForClient(baseProposal);

  assert.ok(proposal);
  assert.equal(proposal.confidence, 0.72);
  assert.equal(proposal.suggestedSizeUsd, 5);
  assert.equal(proposal.suggestedTriggerPrice, 715.26);
  assert.equal(proposal.suggestedTakeProfitPrice, 743.87);
  assert.equal(proposal.suggestedStopLossPrice, 697.38);
  assert.deepEqual(proposal.positionImpact, {
    weight_before: 0,
    weight_after: 0.26,
    cash_after: 14.23,
    sector_before: 0,
    sector_after: 0.26,
  });
});

test('normalizeProposalForClient rejects proposals with missing trade numbers', () => {
  const proposal = normalizeProposalForClient({
    ...baseProposal,
    suggestedSizeUsd: undefined,
  });

  assert.equal(proposal, null);
});
