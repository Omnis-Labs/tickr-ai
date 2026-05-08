'use client';

import { useMemo, type ReactNode } from 'react';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { usePrivy } from '@privy-io/react-auth';
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
 * Future providers (PhantomBridge, …) implement the same
 * shape and replace this in components/wallet/wallet-provider.tsx.
 */
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets() as { wallets: Array<{ address: string; type?: string }> };
  const { signTransaction: privySign } = useSignTransaction();
  const { signAndSendTransaction: privySignAndSend } = useSignAndSendTransaction();
  const { signMessage: privySignMessage } = useSignMessage();
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

    return {
      publicKey,
      address: wallet?.address ?? null,
      connected: ready && authenticated && !!wallet,
      ready,
      signTransaction: wallet
        ? async <T extends VersionedTransaction | Transaction>(tx: T): Promise<T> => {
            const isVersioned = tx instanceof VersionedTransaction;
            const txBytes = isVersioned
              ? tx.serialize()
              : tx.serialize({
                  requireAllSignatures: false,
                  verifySignatures: false,
                });
            const result = (await privySign({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              wallet: wallet as any,
              transaction: txBytes,
              chain: 'solana:mainnet',
              options: {
                uiOptions: { showWalletUIs: false },
              },
            })) as unknown as { signedTransaction: Uint8Array };
            return (
              isVersioned
                ? VersionedTransaction.deserialize(result.signedTransaction)
                : Transaction.from(result.signedTransaction)
            ) as T;
          }
        : STUB_WALLET.signTransaction,
      // Generic wallet send escape hatch. Keep sponsored Jupiter Ultra
      // swaps off this Interface: Ultra orders need Privy signTransaction
      // for the taker signature slot, then Jupiter `/execute` with the
      // signed bytes and requestId. Direct Privy broadcast bypasses the
      // sponsored Ultra relay and can fail multi-signer sponsored txs before
      // program execution.
      signAndSendTransaction: wallet
        ? async (tx: VersionedTransaction | Transaction) => {
            const txBytes =
              tx instanceof VersionedTransaction
                ? tx.serialize()
                : tx.serialize({
                    requireAllSignatures: false,
                    verifySignatures: false,
                  });
            // skipPreflight only applies to generic wallet sends through
            // Privy's RPC path. It is not the Jupiter Ultra sponsored swap
            // path, which must return signed bytes to `/execute`.
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
    ready,
    authenticated,
    login,
    logout,
    privySign,
    privySignAndSend,
    privySignMessage,
    getAccessToken,
    privyFund,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
