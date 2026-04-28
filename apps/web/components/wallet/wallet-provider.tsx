'use client';

import { useMemo, type ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { parseRpcUrls } from '@hunch-it/shared';
import { PrivyWalletBridge } from '@/lib/wallet/use-wallet';

const RAW_PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_ENABLED = !!RAW_PRIVY_APP_ID && RAW_PRIVY_APP_ID.length >= 20;

const RPC_URLS = parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS);

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () =>
      RPC_URLS[0] !== 'https://api.mainnet-beta.solana.com'
        ? RPC_URLS[0]!
        : clusterApiUrl(WalletAdapterNetwork.Mainnet),
    [],
  );

  const inner = <ConnectionProvider endpoint={endpoint}>{children}</ConnectionProvider>;

  if (!PRIVY_ENABLED) {
    // Stub context (default) lets useWallet() return a disconnected state
    // without ever instantiating Privy.
    return inner;
  }

  return (
    <PrivyProvider
      appId={RAW_PRIVY_APP_ID as string}
      config={{
        loginMethods: ['email', 'google', 'apple', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#7c5cff',
          walletChainType: 'solana-only',
        },
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <PrivyWalletBridge>{inner}</PrivyWalletBridge>
    </PrivyProvider>
  );
}
