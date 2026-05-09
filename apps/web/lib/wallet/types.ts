'use client';

import { createContext } from 'react';
import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Unified wallet surface across the app — keeps every call site identical
 * regardless of which provider (Privy or a future Phantom direct connect)
 * is mounted underneath.
 *
 * Provider implementations live under lib/wallet/providers/*. They're the
 * only place that imports a vendor SDK; everything else uses useWallet().
 */
export interface UnifiedWallet {
  publicKey: PublicKey | null;
  address: string | null;
  connected: boolean;
  ready: boolean;
  walletClientType?: string | null;
  connectorType?: string | null;
  privyWalletId?: string | null;
  delegated?: boolean | null;
  authorizationSignerIdConfigured?: boolean;
  delegationMode?: 'legacy-delegated-actions' | 'signers' | null;
  signTransaction: <T extends VersionedTransaction | Transaction>(tx: T) => Promise<T>;
  /** Sign + broadcast in one round-trip. This is for generic wallet sends
   *  only. Sponsored Jupiter Ultra swaps must use signTransaction and hand
   *  the signed bytes back to Jupiter `/execute`; direct wallet broadcast
   *  bypasses the sponsored Ultra relay path. */
  signAndSendTransaction: (
    tx: VersionedTransaction | Transaction,
  ) => Promise<{ signature: string }>;
  /** Sign a UTF-8 message and return a base58 signature. */
  signMessage: (message: string) => Promise<string>;
  login: () => void;
  logout: () => Promise<void>;
  /** Privy access token. null when disconnected. Used as the
   *  Authorization: Bearer credential for /api/* + the ws-server socket. */
  getAccessToken: () => Promise<string | null>;
  /** Dev/advanced: prompt the connected embedded Solana wallet to grant
   *  server-side delegated access. Providers without this capability reject. */
  delegateWallet: () => Promise<void>;
  /** Dev/advanced: revoke delegated access for Privy embedded wallets. */
  revokeDelegatedWallets: () => Promise<void>;
  /** Refresh provider user metadata after delegation changes. */
  refreshWalletUser: () => Promise<void>;
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
  walletClientType: null,
  connectorType: null,
  privyWalletId: null,
  delegated: null,
  authorizationSignerIdConfigured: false,
  delegationMode: null,
  signTransaction: async () => {
    throw new Error('Wallet not connected — call login() first.');
  },
  signAndSendTransaction: async () => {
    throw new Error('Wallet not connected — call login() first.');
  },
  signMessage: async () => {
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
  delegateWallet: async () => {
    throw new Error('Wallet provider does not support delegated access.');
  },
  revokeDelegatedWallets: async () => {
    throw new Error('Wallet provider does not support delegated access.');
  },
  refreshWalletUser: async () => {},
  fundWallet: async () => {},
};

export const WalletContext = createContext<UnifiedWallet>(STUB_WALLET);
