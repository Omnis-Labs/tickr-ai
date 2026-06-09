import assert from 'node:assert/strict';
import test from 'node:test';
import { redirectTargetForUnauthorized } from './unauthorized-redirect';

test('unauthorized redirect ignores boot-time API 401s sent without a bearer token', () => {
  const target = redirectTargetForUnauthorized({
    requestUrl: '/api/portfolio',
    currentPath: '/desk',
    currentSearch: '',
    sentAuthorization: false,
  });

  assert.equal(target, null);
});

test('unauthorized redirect sends authenticated API 401s back through login', () => {
  const target = redirectTargetForUnauthorized({
    requestUrl: '/api/portfolio',
    currentPath: '/desk',
    currentSearch: '?tab=holdings',
    sentAuthorization: true,
  });

  assert.equal(target, '/login?reason=session-expired&next=%2Fdesk%3Ftab%3Dholdings');
});

test('unauthorized redirect ignores public auth probe endpoints and the login page', () => {
  assert.equal(
    redirectTargetForUnauthorized({
      requestUrl: '/api/users/me',
      currentPath: '/desk',
      currentSearch: '',
      sentAuthorization: true,
    }),
    null,
  );
  assert.equal(
    redirectTargetForUnauthorized({
      requestUrl: '/api/me/state',
      currentPath: '/desk',
      currentSearch: '',
      sentAuthorization: true,
    }),
    null,
  );
  assert.equal(
    redirectTargetForUnauthorized({
      requestUrl: '/api/portfolio',
      currentPath: '/login',
      currentSearch: '?next=%2Fdesk',
      sentAuthorization: true,
    }),
    null,
  );
});
