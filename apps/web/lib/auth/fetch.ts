'use client';

import { useCallback } from 'react';
import { isDemo } from '@/lib/demo';
import { useWallet } from '@/lib/wallet/use-wallet';

/**
 * Authed fetch hook. Wraps native fetch and prefixes the Privy access
 * token on the Authorization header for any /api/* call.
 *
 * Reads through useWallet() (not usePrivy directly) so it works whether
 * or not PrivyProvider is mounted — the stub returns null tokens
 * gracefully.
 *
 * 401 handling: a fresh 401 from /api/* almost always means the Privy
 * session expired (refresh token > 30 days unused, or app secret
 * rotated). Rather than letting the page silently render with null
 * data — which often crashes downstream toFixed/toLocaleString calls —
 * we kick the user back to /login so they can re-auth cleanly. Demo
 * mode skips this entirely; demo flows have no real auth.
 *
 * The redirect uses window.location.href so it works from anywhere
 * (page handlers, hooks, mutations) without needing a router ref. We
 * de-dupe via a module-scoped flag so concurrent failed requests don't
 * cause a redirect storm.
 */
let redirecting = false;

function maybeRedirectOnUnauthorized(url: string): void {
  if (typeof window === 'undefined') return;
  if (redirecting) return;
  // Only redirect for our own /api/* — third-party 401s (Jupiter, RPC)
  // shouldn't bounce the user.
  let path: string;
  try {
    path = new URL(url, window.location.origin).pathname;
  } catch {
    return;
  }
  if (!path.startsWith('/api/')) return;
  // Don't loop: the login page itself + the public /api/users/me
  // probe are allowed to receive 401 silently.
  if (window.location.pathname === '/login') return;
  if (path === '/api/users/me') return;

  redirecting = true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?reason=session-expired&next=${next}`;
}

export function useAuthedFetch() {
  const { getAccessToken } = useWallet();

  return useCallback(
    async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (!isDemo() && !headers.has('authorization')) {
        const token = await getAccessToken();
        if (token) headers.set('authorization', `Bearer ${token}`);
      }
      const res = await fetch(input, { ...init, headers });
      if (res.status === 401 && !isDemo()) {
        maybeRedirectOnUnauthorized(typeof input === 'string' ? input : input.toString());
      }
      return res;
    },
    [getAccessToken],
  );
}
