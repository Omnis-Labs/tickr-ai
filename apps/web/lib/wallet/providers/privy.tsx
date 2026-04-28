'use client';

import { useMemo, type ReactNode } from 'react';
import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import { useDelegatedActions, usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';
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
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets() as { wallets: Array<{ address: string; type?: string }> };
  const { signTransaction: privySign } = useSignTransaction();
  const { delegateWallet, revokeWallets } = useDelegatedActions();

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
        : STUB_WALLET.signTransaction,
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
    };
  }, [
    wallet,
    ready,
    authenticated,
    login,
    logout,
    privySign,
    getAccessToken,
    delegateWallet,
    revokeWallets,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
