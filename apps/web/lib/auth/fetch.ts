'use client';

import { useCallback } from 'react';
import { useWallet } from '@/lib/wallet/use-wallet';
import { redirectTargetForUnauthorized } from './unauthorized-redirect';

/**
 * Authed fetch hook. Wraps native fetch and prefixes the Privy access
 * token on the Authorization header for any /api/* call.
 *
 * Reads through useWallet() (not usePrivy directly) so it works whether
 * or not PrivyProvider is mounted — the stub returns null tokens
 * gracefully.
 *
 * 401 handling: an authenticated 401 from /api/* means the Privy
 * session expired (refresh token > 30 days unused, or app secret
 * rotated). Rather than letting the page silently render with null data,
 * we kick the user back to /login so they can re-auth cleanly.
 *
 * A boot-time 401 sent before the wallet provider has produced a bearer
 * token is not an expired session. Those requests are ignored here and the
 * query layer decides whether to retry or show an error.
 *
 * The redirect uses window.location.href so it works from anywhere
 * (page handlers, hooks, mutations) without needing a router ref. We
 * de-dupe via a module-scoped flag so concurrent failed requests don't
 * cause a redirect storm.
 */
let redirecting = false;

function maybeRedirectOnUnauthorized(url: string, sentAuthorization: boolean): void {
  if (typeof window === 'undefined') return;
  if (redirecting) return;

  const target = redirectTargetForUnauthorized({
    requestUrl: url,
    currentPath: window.location.pathname,
    currentSearch: window.location.search,
    sentAuthorization,
    origin: window.location.origin,
  });
  if (!target) return;
  redirecting = true;
  window.location.href = target;
}

export function useAuthedFetch() {
  const { getAccessToken } = useWallet();

  return useCallback(
    async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      let sentAuthorization = headers.has('authorization');
      if (!headers.has('authorization')) {
        const token = await getAccessToken();
        if (token) {
          headers.set('authorization', `Bearer ${token}`);
          sentAuthorization = true;
        }
      }
      const res = await fetch(input, { ...init, headers });
      if (res.status === 401) {
        maybeRedirectOnUnauthorized(typeof input === 'string' ? input : input.toString(), sentAuthorization);
      }
      return res;
    },
    [getAccessToken],
  );
}
