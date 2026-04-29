'use client';

import { createContext } from 'react';
import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Unified wallet surface across the app — keeps every call site identical
 * regardless of which provider (Privy, demo stub, or a future Phantom
 * direct connect) is mounted underneath.
 *
 * Provider implementations live under lib/wallet/providers/*. They're the
 * only place that imports a vendor SDK; everything else uses useWallet().
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
   *  Authorization: Bearer credential for /api/* + the ws-server socket. */
  getAccessToken: () => Promise<string | null>;
  /** Phase F — request the delegation grant for the user's embedded wallet.
   *  Resolves once the user accepts (or rejects) the modal. No-op when no
   *  provider is mounted. */
  delegateSolanaWallet: () => Promise<void>;
  /** Revoke all delegated wallets. */
  revokeDelegations: () => Promise<void>;
  /** Open the Privy funding modal (fiat on-ramp / external wallet transfer)
   *  for the user's embedded wallet. amountUsdc, when supplied, prefills the
   *  USDC amount on Solana mainnet. Resolves once the modal closes. No-op
   *  when no provider is mounted. */
  fundWallet: (amountUsdc?: number) => Promise<void>;
}

export const STUB_WALLET: UnifiedWallet = {
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
        '[wallet] No provider mounted (NEXT_PUBLIC_PRIVY_APP_ID missing). Login disabled.',
      );
    }
  },
  logout: async () => {},
  getAccessToken: async () => null,
  delegateSolanaWallet: async () => {},
  revokeDelegations: async () => {},
  fundWallet: async () => {},
};

export const WalletContext = createContext<UnifiedWallet>(STUB_WALLET);
