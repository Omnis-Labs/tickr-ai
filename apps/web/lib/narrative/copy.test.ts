import assert from 'node:assert/strict';
import test from 'node:test';
import { landingNarrativeCopy } from './copy';

test('landing narrative copy presents vibe trades as disciplined proposals', () => {
  assert.match(landingNarrativeCopy.heroBody, /Gen Z already invests by vibe/);
  assert.match(landingNarrativeCopy.heroBody, /disciplined proposal/);
  assert.match(landingNarrativeCopy.productPromise, /friends, creators, social feeds, or market moves/);
  assert.deepEqual(landingNarrativeCopy.howItWorks, [
    'Bring a trade idea from friends, creators, or social feeds and have it vetted by AI analysts you choose.',
    'Choose AI analysts that watch the market and send new proposals.',
  ]);
});
