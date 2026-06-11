import assert from 'node:assert/strict';
import test from 'node:test';
import type { Asset } from '@hunch-it/shared';
import { getHotGrillAssets } from './hot-assets';

function asset(assetId: string): Asset {
  return {
    assetId,
    displaySymbol: assetId,
    name: `${assetId} asset`,
    kind: assetId.endsWith('x') ? 'XSTOCK' : 'CRYPTO',
    mint: 'mint',
    decimals: 6,
    pythFeedId: 'feed',
    pythSymbol: `Crypto.${assetId}/USD`,
  };
}

test('Grill hot assets are hashtag shortcuts filtered to supported assets', () => {
  const hot = getHotGrillAssets([asset('ETH'), asset('NVDAx'), asset('HYPE'), asset('QQQx')]);

  assert.deepEqual(
    hot.map((item) => item.assetId),
    ['NVDAx', 'HYPE', 'ETH'],
  );
  assert.deepEqual(
    hot.map((item) => item.hashtag),
    ['#NVDAx', '#HYPE', '#ETH'],
  );
});
