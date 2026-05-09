import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePortfolioSummary } from './summary';

test('derivePortfolioSummary centralizes portfolio header math', () => {
  const summary = derivePortfolioSummary({
    positions: [
      {
        id: 'position-1',
        ticker: 'HYPE',
        tokenAmount: 2,
        avgCost: 10,
        markPrice: 12,
        pnl: 4,
      },
      {
        id: 'position-2',
        ticker: 'ETH',
        tokenAmount: 1,
        avgCost: 100,
        markPrice: 90,
        pnl: -10,
      },
    ],
    pnl: { realized: 5, unrealized: -6 },
    cashUsd: 20,
  });

  assert.equal(summary.positionsCount, 2);
  assert.equal(summary.hasHoldings, true);
  assert.equal(summary.realized, 5);
  assert.equal(summary.unrealized, -6);
  assert.equal(summary.totalPnl, -1);
  assert.equal(summary.dayPnl, -6);
  assert.equal(summary.cashUsd, 20);
  assert.equal(summary.positionsValue, 114);
  assert.equal(summary.totalValue, 134);
  assert.equal(summary.totalPnlPct, -1 / 134);
  assert.equal(summary.dayPnlPct, -6 / 134);
  assert.equal(summary.dayPnlPositive, false);
  assert.equal(summary.totalPnlPositive, false);
});

test('derivePortfolioSummary returns stable zero defaults for empty data', () => {
  const summary = derivePortfolioSummary(undefined);

  assert.deepEqual(summary.holdings, []);
  assert.equal(summary.positionsCount, 0);
  assert.equal(summary.hasHoldings, false);
  assert.equal(summary.totalValue, 0);
  assert.equal(summary.totalPnlPct, 0);
  assert.equal(summary.dayPnlPct, 0);
  assert.equal(summary.dayPnlPositive, true);
  assert.equal(summary.totalPnlPositive, true);
});
