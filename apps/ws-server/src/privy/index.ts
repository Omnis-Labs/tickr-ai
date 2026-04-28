// Privy server-signer helper.
//
// Phase F — when a user has flipped `delegationActive=true` in /settings, the
// Order Tracker is allowed to call the Privy server SDK to sign a Jupiter
// withdrawal / cancel transaction without a fresh user prompt. This helper
// wraps that path with graceful degradation: if PRIVY_APP_ID / PRIVY_APP_SECRET
// are missing or the SDK isn't installed, every call returns null and the
// caller falls back to the user-prompted path (position:updated event).
//
// Reference: https://docs.privy.io/wallets/using-wallets/server-signers
// (Pricing: requires Privy Pro plan.)

import { env } from '../env.js';

let lazyClient: unknown | null = null;
let lazyClientFailed = false;

interface PrivyServerClient {
  signSolanaTransaction?: (input: {
    walletId: string;
    transactionBase64: string;
  }) => Promise<{ signedTransactionBase64: string }>;
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
    console.warn('[privy] server SDK unavailable; auto-cancel disabled', err);
    lazyClientFailed = true;
    return null;
  }
}

/**
 * Sign a base64-encoded Solana transaction using the user's Privy embedded
 * wallet. Returns null if delegation isn't possible (no SDK, missing creds,
 * or upstream error). Caller should fall back to user-prompted signing.
 */
export async function signTransactionDelegated(input: {
  privyWalletId: string;
  transactionBase64: string;
}): Promise<string | null> {
  const client = await getPrivyClient();
  if (!client) return null;
  if (typeof client.signSolanaTransaction !== 'function') {
    console.warn('[privy] signSolanaTransaction not available on installed SDK version');
    return null;
  }
  try {
    const res = await client.signSolanaTransaction({
      walletId: input.privyWalletId,
      transactionBase64: input.transactionBase64,
    });
    return res.signedTransactionBase64;
  } catch (err) {
    console.warn('[privy] signSolanaTransaction failed', err);
    return null;
  }
}

export function isDelegationConfigured(): boolean {
  return !!env.PRIVY_APP_ID && !!env.PRIVY_APP_SECRET;
}
