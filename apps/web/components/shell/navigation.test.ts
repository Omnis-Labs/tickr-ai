import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appNavigationItems,
  isAppNavigationItemActive,
  shouldShowAppNavigation,
} from './navigation';

test('app navigation exposes the primary signed-in surfaces', () => {
  assert.deepEqual(
    appNavigationItems.map((item) => item.name),
    ['Home', 'Grill', 'Analysts', 'Portfolio'],
  );
});

test('app navigation visibility follows signed-in shell routes', () => {
  assert.equal(shouldShowAppNavigation('/desk'), true);
  assert.equal(shouldShowAppNavigation('/portfolio'), true);
  assert.equal(shouldShowAppNavigation('/settings'), true);
  assert.equal(shouldShowAppNavigation('/'), false);
  assert.equal(shouldShowAppNavigation('/login'), false);
  assert.equal(shouldShowAppNavigation('/mandate'), false);
  assert.equal(shouldShowAppNavigation('/proposals/proposal-1'), false);
});

test('app navigation marks nested route items active', () => {
  const home = appNavigationItems[0]!;

  assert.equal(isAppNavigationItemActive('/desk', home), true);
  assert.equal(isAppNavigationItemActive('/desk/position', home), true);
  assert.equal(isAppNavigationItemActive('/portfolio', home), false);
});
