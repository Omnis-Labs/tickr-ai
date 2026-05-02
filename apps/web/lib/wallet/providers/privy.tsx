'use client';

import { useMemo, type ReactNode } from 'react';
import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import { useDelegatedActions, usePrivy } from '@privy-io/react-auth';
import {
  useWallets,
  useSignTransaction,
  useSignAndSendTransaction,
  useSignMessage,
  useFundWallet,
  useSolanaFundingPlugin,
} from '@privy-io/react-auth/solana';
import bs58 from 'bs58';
import { STUB_WALLET, WalletContext, type UnifiedWallet } from '../types';

/**
 * The only file that imports @privy-io/react-auth. Mounted INSIDE
 * PrivyProvider; bridges Privy's various hooks into our UnifiedWallet
 * context so consumers stay vendor-agnostic.
 *
 * Future providers (DemoBridge, PhantomBridge, …) implement the same
 * shape and replace this in components/wallet/wallet-provider.tsx.
 */
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken, user } = usePrivy();
  const { wallets } = useWallets() as { wallets: Array<{ address: string; type?: string }> };
  const { signTransaction: privySign } = useSignTransaction();
  const { signAndSendTransaction: privySignAndSend } = useSignAndSendTransaction();
  const { signMessage: privySignMessage } = useSignMessage();
  const { delegateWallet, revokeWallets } = useDelegatedActions();
  // Register Solana funding capabilities so useFundWallet has providers wired.
  useSolanaFundingPlugin();
  const { fundWallet: privyFund } = useFundWallet();

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

    // Match the embedded Privy wallet to the connected wallet's address so
    // we read the right `id` (server wallet ID, populated post-delegation).
    const privyEmbedded = user?.linkedAccounts?.find(
      (acct) =>
        acct.type === 'wallet' &&
        (acct as { address?: string }).address === wallet?.address,
    ) as { id?: string | null; delegated?: boolean } | undefined;

    return {
      publicKey,
      address: wallet?.address ?? null,
      walletId: privyEmbedded?.id ?? user?.wallet?.id ?? null,
      delegated: !!privyEmbedded?.delegated || !!user?.wallet?.delegated,
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
        : STUB_WALLET.signTransaction,
      // useSignAndSendTransaction signs + broadcasts in one call and
      // accepts options.uiOptions.showWalletUIs=false, which
      // useSignTransaction does NOT honour. The Jupiter Ultra route tx
      // tickles a borsh decoder bug in Privy's preview modal
      // ("t.slice is not a function") that disables Approve and traps
      // the user. Going through signAndSendTransaction skips that modal
      // entirely. Tradeoff: we lose Jupiter Ultra's MEV-aware bundled
      // relay (we don't feed signed bytes back to /execute — Privy
      // broadcasts via its own RPC), but for the BUY trigger →
      // tap-to-execute flow that's an acceptable hackathon-stage call.
      //
      // Note Privy's hook expects `transaction: Uint8Array` (raw
      // serialized bytes), not a VersionedTransaction object — so we
      // serialize here. That alone is what dodges the introspection
      // bug, since Privy can't decode an opaque byte buffer.
      signAndSendTransaction: wallet
        ? async (tx: VersionedTransaction | Transaction) => {
            const txBytes =
              'serialize' in tx
                ? // VersionedTransaction.serialize() returns Uint8Array
                  // already; legacy Transaction.serialize() returns
                  // Buffer (a Node Uint8Array subclass) — both fine here.
                  (tx as VersionedTransaction).serialize()
                : new Uint8Array((tx as Transaction).serialize());
            // skipPreflight: true is intentional. The Ultra-quoted tx
            // carries a recentBlockhash that's only valid ~150 slots
            // (~60s); the node-side preflight `simulateTransaction` is
            // strict about that window and was returning -32002
            // (RPC_TRANSACTION_PRECHECK_FAILED, all fields null,
            // unitsConsumed=0) when Privy's broadcast RPC saw the
            // blockhash as stale even though the tx itself is fine on a
            // current leader. Skipping preflight lets the actual leader
            // accept it; `maxRetries` keeps the leader retrying briefly
            // if the first send raced a slot boundary.
            const result = await privySignAndSend({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              wallet: wallet as any,
              transaction: txBytes,
              chain: 'solana:mainnet',
              options: {
                uiOptions: { showWalletUIs: false },
                skipPreflight: true,
                maxRetries: 3,
              },
            });
            return { signature: bs58.encode(result.signature) };
          }
        : STUB_WALLET.signAndSendTransaction,
      signMessage: wallet
        ? async (message: string): Promise<string> => {
            const bytes = new TextEncoder().encode(message);
            const result = await privySignMessage({
              message: bytes,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              wallet: wallet as any,
            });
            return bs58.encode(result.signature);
          }
        : STUB_WALLET.signMessage,
      login,
      logout,
      getAccessToken: async () => {
        if (!ready || !authenticated) return null;
        return getAccessToken().catch(() => null);
      },
      delegateSolanaWallet: async () => {
        if (!wallet?.address) throw new Error('No Solana wallet to delegate.');
        await delegateWallet({ address: wallet.address, chainType: 'solana' });
      },
      revokeDelegations: async () => {
        await revokeWallets();
      },
      fundWallet: async (amountUsdc?: number) => {
        if (!wallet?.address) throw new Error('No Solana wallet to fund.');
        await privyFund({
          address: wallet.address,
          options: {
            chain: 'solana:mainnet',
            asset: 'USDC',
            ...(amountUsdc != null ? { amount: String(amountUsdc) } : {}),
          },
        });
      },
    };
  }, [
    wallet,
    user,
    ready,
    authenticated,
    login,
    logout,
    privySign,
    privySignAndSend,
    privySignMessage,
    getAccessToken,
    delegateWallet,
    revokeWallets,
    privyFund,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
