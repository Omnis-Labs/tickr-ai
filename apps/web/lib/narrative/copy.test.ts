import assert from 'node:assert/strict';
import test from 'node:test';
import { appNarrativeCopy, landingNarrativeCopy } from './copy';

test('landing narrative copy presents vibe trades as disciplined proposals', () => {
  assert.equal(landingNarrativeCopy.heroTitle, 'Got a hunch?');
  assert.match(landingNarrativeCopy.heroBody, /Gen Z already invests by vibe/);
  assert.match(landingNarrativeCopy.heroBody, /disciplined proposal/);
  assert.match(landingNarrativeCopy.productPromise, /friends, creators, social feeds, or market moves/);
  assert.deepEqual(landingNarrativeCopy.howItWorks, [
    'Bring a trade idea from friends, creators, or social feeds and have it vetted by AI analysts you choose.',
    'Choose AI analysts that watch the market and send new proposals.',
  ]);
});

test('app narrative copy keeps login on the latest product story', () => {
  assert.match(appNarrativeCopy.loginIntro, /friends, creators, and feeds/);
  assert.match(appNarrativeCopy.loginIntro, /disciplined proposals/);
  assert.match(appNarrativeCopy.loginIntro, /AI analysts you choose/);
});
