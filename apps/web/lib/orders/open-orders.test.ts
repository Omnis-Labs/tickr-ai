import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeOpenOrderForClient } from './open-orders';

test('open order serialization exposes the parent position ticker for desk display', () => {
  const row = serializeOpenOrderForClient({
    id: 'order-1',
    positionId: 'cmoy7vaxabc123',
    kind: 'STOP_LOSS',
    side: 'SELL',
    status: 'OPEN',
    jupiterOrderId: null,
    triggerPriceUsd: 694.61,
    sizeUsd: 4.85,
    tokenAmount: 0.00698,
    position: { ticker: 'QQQx' },
  });

  assert.equal(row.ticker, 'QQQx');
  assert.equal(row.positionId, 'cmoy7vaxabc123');
  assert.equal(Object.hasOwn(row, 'position'), false);
});
