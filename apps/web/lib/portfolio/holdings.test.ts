import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMarkPricesToPortfolioPositions,
  portfolioPositionsToHoldings,
} from './holdings';

test('portfolio holdings preserve the canonical position id for detail links', () => {
  const [holding] = portfolioPositionsToHoldings([
    {
      id: 'cmoxcdsfn0002rg8k40e3e9sb',
      ticker: 'HYPE',
      tokenAmount: 2,
      avgCost: 10,
      markPrice: 12,
    },
  ]);

  assert.equal(holding?.id, 'cmoxcdsfn0002rg8k40e3e9sb');
  assert.notEqual(holding?.id, 'HYPE-0');
});

test('portfolio positions use current marks for value and unrealized pnl', () => {
  const { positions, unrealized } = applyMarkPricesToPortfolioPositions(
    [
      {
        id: 'position-1',
        ticker: 'HYPE',
        tokenAmount: 2,
        avgCost: 10,
        markPrice: 10,
        pnl: 0,
      },
    ],
    new Map([['HYPE', 12]]),
  );
  const [holding] = portfolioPositionsToHoldings(positions);

  assert.equal(positions[0]?.markPrice, 12);
  assert.equal(positions[0]?.pnl, 4);
  assert.equal(unrealized, 4);
  assert.equal(holding?.value, 24);
  assert.equal(holding?.pnlPct, 0.2);
});

test('portfolio holdings include zero-token pending buys with their pending notional', () => {
  const [holding] = portfolioPositionsToHoldings([
    {
      id: 'pending-position-1',
      ticker: 'QQQx',
      tokenAmount: 0,
      avgCost: 43.26,
      markPrice: 43.26,
      pendingSizeUsd: 5,
      state: 'BUY_PENDING',
    },
  ]);

  assert.equal(holding?.id, 'pending-position-1');
  assert.equal(holding?.value, 5);
  assert.equal(holding?.pnl, 0);
  assert.equal(holding?.pnlPct, 0);
  assert.equal(holding?.state, 'BUY_PENDING');
  assert.equal(holding?.isPendingBuy, true);
});
