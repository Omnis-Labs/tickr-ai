'use client';

import { useCallback } from 'react';
import { isDemo } from '@/lib/demo';
import { useWallet } from '@/lib/wallet/use-wallet';

/**
 * Authed fetch hook. Wraps native fetch and prefixes the Privy access token
 * on the Authorization header for any /api/* call. Demo mode skips token
 * acquisition entirely so the UX still works without a Privy session.
 *
 * Reads through useWallet() (not usePrivy directly) so it works whether or
 * not PrivyProvider is mounted — the stub returns null tokens gracefully.
 */
export function useAuthedFetch() {
  const { getAccessToken } = useWallet();

  return useCallback(
    async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (!isDemo() && !headers.has('authorization')) {
        const token = await getAccessToken();
        if (token) headers.set('authorization', `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers });
    },
    [getAccessToken],
  );
}
