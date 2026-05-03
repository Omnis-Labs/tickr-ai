'use client';

import { useMemo, type ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { parseRpcUrls } from '@hunch-it/shared';
import { PrivyWalletBridge } from '@/lib/wallet/use-wallet';

const RAW_PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_ENABLED = !!RAW_PRIVY_APP_ID && RAW_PRIVY_APP_ID.length >= 20;

const RPC_URLS = parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS);

/**
 * Pick a Solana RPC for Privy v3's signTransaction flow.
 *
 * Privy v3 internally uses @solana/kit and requires a `solana.rpcs`
 * map per chain — without it, signTransaction throws "No RPC
 * configuration found for chain solana:mainnet". We build one rpc +
 * subscriptions client per configured endpoint, picking the first url
 * for both. The wss subscriptions URL is derived from the http url
 * (replace https→wss / http→ws), since not every RPC ships an explicit
 * websocket endpoint env.
 */
function buildSolanaRpcs() {
  const httpUrl = RPC_URLS[0] ?? 'https://api.mainnet-beta.solana.com';
  const wssUrl = httpUrl.replace(/^http/, 'ws');
  return {
    'solana:mainnet': {
      rpc: createSolanaRpc(httpUrl),
      rpcSubscriptions: createSolanaRpcSubscriptions(wssUrl),
      blockExplorerUrl: 'https://explorer.solana.com',
    },
  } as const;
}

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () =>
      RPC_URLS[0] !== 'https://api.mainnet-beta.solana.com'
        ? RPC_URLS[0]!
        : clusterApiUrl(WalletAdapterNetwork.Mainnet),
    [],
  );

  const solanaRpcs = useMemo(() => buildSolanaRpcs(), []);

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        solana: { rpcs: solanaRpcs as any },
      }}
    >
      <PrivyWalletBridge>{inner}</PrivyWalletBridge>
    </PrivyProvider>
  );
}
