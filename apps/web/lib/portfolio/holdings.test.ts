import assert from 'node:assert/strict';
import test from 'node:test';
import { portfolioPositionsToHoldings } from './holdings';

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
