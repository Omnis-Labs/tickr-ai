import assert from 'node:assert/strict';
import test from 'node:test';
import { portfolioSummaryEvidence } from './diagnostics';
import { buildPortfolioSummary, derivePortfolioSummary } from './summary';

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
  assert.equal(summary.realizedPnl, 5);
  assert.equal(summary.unrealizedPnl, -6);
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
  assert.deepEqual(summary.closablePositions, []);
  assert.equal(summary.positionsCount, 0);
  assert.equal(summary.hasHoldings, false);
  assert.equal(summary.hasCash, false);
  assert.equal(summary.totalValue, 0);
  assert.equal(summary.totalPnlPct, 0);
  assert.equal(summary.dayPnlPct, 0);
  assert.equal(summary.dayPnlPositive, true);
  assert.equal(summary.totalPnlPositive, true);
});

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
  const summary = derivePortfolioSummary({
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

test('portfolio summary shows pending buys without double-counting cash', () => {
  const summary = derivePortfolioSummary({
    cashUsd: 14.23,
    positions: [
      {
        id: 'active-position-1',
        ticker: 'QQQx',
        tokenAmount: 0.007194,
        avgCost: 694.61,
        markPrice: 694.61,
        pnl: 0,
        state: 'ACTIVE',
      },
      {
        id: 'pending-position-1',
        ticker: 'AAPLx',
        tokenAmount: 0,
        avgCost: 43.26,
        markPrice: 43.26,
        pendingSizeUsd: 5,
        state: 'BUY_PENDING',
      },
    ],
    pnl: { realized: -0.78, unrealized: 0 },
  });

  assert.equal(summary.holdings.length, 2);
  assert.equal(summary.holdings[1]?.id, 'pending-position-1');
  assert.equal(summary.holdings[1]?.isPendingBuy, true);
  assert.equal(summary.positionsValue.toFixed(2), '5.00');
  assert.equal(summary.totalValue.toFixed(2), '19.23');
  assert.equal(summary.positionsCount, 1);
  assert.equal(summary.closablePositions.length, 1);
});

test('portfolioSummaryEvidence exposes the compact post-action diagnostic snapshot', () => {
  const snapshot = portfolioSummaryEvidence({
    cashUsd: 5,
    positions: [
      {
        id: 'position-1',
        ticker: 'SPYx',
        tokenAmount: 0.2,
        avgCost: 125,
        markPrice: 100,
        pnl: -5,
        state: 'ACTIVE',
      },
    ],
    pnl: { realized: -1, unrealized: -5 },
  });

  assert.deepEqual(snapshot, {
    cashUsd: 5,
    activePositions: 1,
    realizedPnl: -1,
    unrealizedPnl: -5,
    totalPnl: -6,
    positionsValue: 20,
    totalValue: 25,
  });
});
