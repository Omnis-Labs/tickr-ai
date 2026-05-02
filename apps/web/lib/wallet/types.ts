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
  /** Privy server-wallet id (populated only after the user has delegated
   *  signing for this embedded wallet). Required by the server SDK's
   *  signSolanaTransaction({ walletId }) call, so we thread it through to
   *  /api/users/delegation when the toggle flips on. */
  walletId: string | null;
  /** Whether the user has granted delegation for this embedded wallet. */
  delegated: boolean;
  connected: boolean;
  ready: boolean;
  signTransaction: <T extends VersionedTransaction | Transaction>(tx: T) => Promise<T>;
  /** Sign + broadcast in one round-trip, bypassing Privy v3's
   *  transaction-preview modal (which chokes on Jupiter Ultra multi-hop
   *  txs with `t.slice is not a function`). Returns the on-chain signature.
   *  Use when you don't need the signed-but-unbroadcast tx (i.e. you're
   *  not handing off to Jupiter Ultra `/execute` for bundled relay). */
  signAndSendTransaction: (
    tx: VersionedTransaction | Transaction,
  ) => Promise<{ signature: string }>;
  /** Sign a UTF-8 message and return a base58 signature. Used by the
   *  Jupiter Trigger v2 auth handshake — message-signing avoids
   *  Privy's transaction-simulation pre-flight, which chokes on
   *  Jupiter's challenge tx (memo-style transaction without sufficient
   *  state for simulation). */
  signMessage: (message: string) => Promise<string>;
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
  walletId: null,
  delegated: false,
  connected: false,
  ready: true, // "ready to NOT auth" so the WalletButton renders Connect
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
  delegateSolanaWallet: async () => {},
  revokeDelegations: async () => {},
  fundWallet: async () => {},
};

export const WalletContext = createContext<UnifiedWallet>(STUB_WALLET);
