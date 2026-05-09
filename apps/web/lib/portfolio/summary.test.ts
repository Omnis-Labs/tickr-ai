import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortfolioSummary } from './summary';

test('portfolio summary values idle USDC as total value even when realized PnL is negative', () => {
  const summary = buildPortfolioSummary({
    cashUsd: 19.23,
    positions: [],
    pnl: { realized: -0.78, unrealized: 0 },
  });

  assert.equal(summary.totalValue, 19.23);
  assert.equal(summary.positionsValue, 0);
  assert.equal(summary.totalPnl, -0.78);
  assert.equal(summary.totalPnlPct, -0.78 / 19.23);
  assert.equal(summary.hasCash, true);
  assert.equal(summary.hasHoldings, false);
});

test('portfolio summary combines cash and mark value for open holdings', () => {
  const summary = buildPortfolioSummary({
    cashUsd: 5,
    positions: [
      {
        id: 'position-1',
        ticker: 'HYPE',
        tokenAmount: 2,
        avgCost: 10,
        markPrice: 12,
        pnl: 4,
        state: 'ACTIVE',
      },
    ],
    pnl: { realized: -1, unrealized: 4 },
  });

  assert.equal(summary.positionsValue, 24);
  assert.equal(summary.totalValue, 29);
  assert.equal(summary.dayPnl, 4);
  assert.equal(summary.totalPnl, 3);
  assert.equal(summary.closablePositions.length, 1);
  assert.deepEqual(summary.closablePositions[0], {
    id: 'position-1',
    ticker: 'HYPE',
    tokenAmount: 2,
    entryPrice: 10,
    state: 'ACTIVE',
  });
});
