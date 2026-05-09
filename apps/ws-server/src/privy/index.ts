// Privy server-auth helper.
//
// ws-server verifies browser-supplied Privy access tokens before joining a
// user Socket.IO room. Delegated wallet signing lives in delegated-wallet.ts;
// this helper stays focused on socket authentication.

import { env } from '../env.js';

let lazyClient: unknown | null = null;
let lazyClientFailed = false;

interface PrivyServerClient {
  verifyAuthToken?: (token: string) => Promise<{ userId: string } | null | undefined>;
}

async function getPrivyClient(): Promise<PrivyServerClient | null> {
  if (lazyClientFailed) return null;
  if (lazyClient) return lazyClient as PrivyServerClient;
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) return null;

  try {
    // Dynamic import so a missing/incompatible SDK doesn't crash boot.
    const sdk = (await import('@privy-io/server-auth')) as {
      PrivyClient: new (id: string, secret: string) => PrivyServerClient;
    };
    lazyClient = new sdk.PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
    return lazyClient as PrivyServerClient;
  } catch (err) {
    console.warn('[privy] server SDK unavailable; socket auth disabled', err);
    lazyClientFailed = true;
    return null;
  }
}

/**
 * Verify a Privy access token forwarded by the frontend on socket connect.
 * Returns the canonical `did:privy:...` userId on success, or null on failure
 * / missing creds.
 */
export async function verifyPrivyToken(token: string): Promise<string | null> {
  const client = await getPrivyClient();
  if (!client || typeof client.verifyAuthToken !== 'function') return null;
  try {
    const verified = await client.verifyAuthToken(token);
    if (!verified?.userId) return null;
    return verified.userId;
  } catch {
    return null;
  }
}
