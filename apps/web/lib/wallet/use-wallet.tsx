'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';

/**
 * Unified wallet surface across the app — abstracts whether Privy is
 * configured (with a valid app id) or not. Demo mode + missing app id both
 * fall through to a disconnected stub so call sites stay identical.
 */
export interface UnifiedWallet {
  publicKey: PublicKey | null;
  address: string | null;
  connected: boolean;
  ready: boolean;
  signTransaction: <T extends VersionedTransaction | Transaction>(tx: T) => Promise<T>;
  login: () => void;
  logout: () => Promise<void>;
  /** Privy access token. null in demo / disconnected state. Used as the
   * Authorization: Bearer credential for /api/* + the ws-server socket. */
  getAccessToken: () => Promise<string | null>;
}

const STUB: UnifiedWallet = {
  publicKey: null,
  address: null,
  connected: false,
  ready: true, // "ready to NOT auth" so the WalletButton renders Connect
  signTransaction: async () => {
    throw new Error('Wallet not connected — call login() first.');
  },
  login: () => {
    if (typeof console !== 'undefined') {
      console.warn(
        '[wallet] Privy not configured (NEXT_PUBLIC_PRIVY_APP_ID missing). Login is disabled.',
      );
    }
  },
  logout: async () => {
    /* noop */
  },
  getAccessToken: async () => null,
};

const WalletContext = createContext<UnifiedWallet>(STUB);

export function useWallet(): UnifiedWallet {
  return useContext(WalletContext);
}

/**
 * Mounted INSIDE PrivyProvider — bridges Privy hooks into our context.
 * Reads usePrivy + useWallets + useSignTransaction in one place; consumers
 * only `useContext(WalletContext)` so they don't need to live under PrivyProvider.
 */
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets() as { wallets: Array<{ address: string; type?: string }> };
  const { signTransaction: privySign } = useSignTransaction();

  const wallet = wallets[0];
  const value = useMemo<UnifiedWallet>(() => {
    const publicKey = (() => {
      if (!wallet?.address) return null;
      try {
        return new PublicKey(wallet.address);
      } catch {
        return null;
      }
    })();

    return {
      publicKey,
      address: wallet?.address ?? null,
      connected: ready && authenticated && !!wallet,
      ready,
      signTransaction: wallet
        ? async <T extends VersionedTransaction | Transaction>(tx: T): Promise<T> => {
            const result = (await privySign({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              wallet: wallet as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              transaction: tx as any,
              chain: 'solana:mainnet',
            })) as unknown as { signedTransaction: T };
            return result.signedTransaction;
          }
        : STUB.signTransaction,
      login,
      logout,
      getAccessToken: async () => {
        if (!ready || !authenticated) return null;
        return getAccessToken().catch(() => null);
      },
    };
  }, [wallet, ready, authenticated, login, logout, privySign, getAccessToken]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
