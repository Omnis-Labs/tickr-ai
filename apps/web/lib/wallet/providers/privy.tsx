'use client';

import { useMemo, type ReactNode } from 'react';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { useDelegatedActions, usePrivy, useSigners, useUser } from '@privy-io/react-auth';
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

const AUTHORIZATION_SIGNER_ID =
  process.env.NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID?.trim() ?? '';
const AUTHORIZATION_POLICY_IDS = (
  process.env.NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_POLICY_IDS ?? ''
)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

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
  const { user, refreshUser } = useUser();
  const { delegateWallet: privyDelegateWallet, revokeWallets } = useDelegatedActions();
  const { addSigners, removeSigners } = useSigners();
  const { wallets } = useWallets() as { wallets: Array<{ address: string; type?: string }> };
  const { signTransaction: privySign } = useSignTransaction();
  const { signAndSendTransaction: privySignAndSend } = useSignAndSendTransaction();
  const { signMessage: privySignMessage } = useSignMessage();
  // Register Solana funding capabilities so useFundWallet has providers wired.
  useSolanaFundingPlugin();
  const { fundWallet: privyFund } = useFundWallet();

  const wallet = wallets[0];
  const linkedWallet = useMemo(() => {
    if (!wallet?.address) return null;
    return (
      user?.linkedAccounts.find((account) => {
        if (account.type !== 'wallet') return false;
        const record = account as unknown as Record<string, unknown>;
        const address = record.address;
        const chainType = record.chainType ?? record.chain_type;
        const connectorType = record.connectorType ?? record.connector_type;
        const walletClientType = record.walletClientType ?? record.wallet_client;
        return (
          address === wallet.address &&
          chainType === 'solana' &&
          connectorType === 'embedded' &&
          (walletClientType === 'privy' || walletClientType === 'privy-v2')
        );
      }) ?? null
    );
  }, [user?.linkedAccounts, wallet?.address]);
  const value = useMemo<UnifiedWallet>(() => {
    const linkedRecord = linkedWallet as unknown as Record<string, unknown> | null;
    const delegated = typeof linkedRecord?.delegated === 'boolean' ? linkedRecord.delegated : null;
    const privyWalletId =
      typeof linkedRecord?.id === 'string' && linkedRecord.id.length > 0 ? linkedRecord.id : null;
    const walletClientType =
      typeof (linkedRecord?.walletClientType ?? linkedRecord?.wallet_client) === 'string'
        ? String(linkedRecord?.walletClientType ?? linkedRecord?.wallet_client)
        : null;
    const connectorType =
      typeof (linkedRecord?.connectorType ?? linkedRecord?.connector_type) === 'string'
        ? String(linkedRecord?.connectorType ?? linkedRecord?.connector_type)
        : null;
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
      walletClientType,
      connectorType,
      privyWalletId,
      delegated,
      authorizationSignerIdConfigured: AUTHORIZATION_SIGNER_ID.length > 0,
      delegationMode: AUTHORIZATION_SIGNER_ID
        ? 'signers'
        : walletClientType === 'privy'
          ? 'legacy-delegated-actions'
          : null,
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
      delegateWallet: async () => {
        if (!wallet?.address) throw new Error('No Solana wallet to delegate.');
        if (!linkedRecord) {
          throw new Error('Connected wallet is not a Privy embedded Solana wallet.');
        }
        if (
          linkedRecord.chainType !== 'solana' &&
          (linkedRecord as Record<string, unknown>).chain_type !== 'solana'
        ) {
          throw new Error('Only Solana embedded wallets can be delegated here.');
        }
        if (
          linkedRecord.connectorType !== 'embedded' &&
          (linkedRecord as Record<string, unknown>).connector_type !== 'embedded'
        ) {
          throw new Error('Only Privy embedded wallets support delegated access here.');
        }
        if (walletClientType !== 'privy' && walletClientType !== 'privy-v2') {
          throw new Error(
            `Unsupported Privy wallet client type: ${walletClientType ?? 'unknown'}.`,
          );
        }
        if (delegated === true) {
          await refreshUser().catch(() => null);
          return;
        }
        if (AUTHORIZATION_SIGNER_ID) {
          await addSigners({
            address: wallet.address,
            signers: [
              {
                signerId: AUTHORIZATION_SIGNER_ID,
                ...(AUTHORIZATION_POLICY_IDS.length > 0
                  ? { policyIds: AUTHORIZATION_POLICY_IDS }
                  : {}),
              },
            ],
          });
          await refreshUser().catch(() => null);
          return;
        }
        await privyDelegateWallet({ address: wallet.address, chainType: 'solana' });
        await refreshUser().catch(() => null);
      },
      revokeDelegatedWallets: async () => {
        if (wallet?.address && AUTHORIZATION_SIGNER_ID) {
          await removeSigners({ address: wallet.address });
        } else {
          await revokeWallets();
        }
        await refreshUser().catch(() => null);
      },
      refreshWalletUser: async () => {
        await refreshUser();
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
    linkedWallet,
    ready,
    authenticated,
    login,
    logout,
    privyDelegateWallet,
    addSigners,
    removeSigners,
    revokeWallets,
    refreshUser,
    privySign,
    privySignAndSend,
    privySignMessage,
    getAccessToken,
    privyFund,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
