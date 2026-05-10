'use client';

import { useCallback, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { useWallet } from '@/lib/wallet/use-wallet';
import type { UltraOrderResponse } from '@/lib/jupiter';
import {
  executeJupiterUltraSwap,
  type JupiterSwapLoading,
  type SwapArgs,
  type SwapResult,
} from './ultra-swap';

export {
  JupiterSwapError,
  type BlockhashAgeBucket,
  type BlockhashValidityDiagnostic,
  type JupiterSwapDebug,
  type JupiterSwapPhase,
  type PreBroadcastSimulationDiagnostic,
  type SwapArgs,
  type SwapDiagnosticsMode,
  type SwapDiagnosticsOptions,
  type SwapDirection,
  type SwapResult,
  type SwapSellBalanceDebug,
  type TransactionShapeDebug,
} from './ultra-swap';

/**
 * React Adapter for the JupiterUltraSwap Module. The sponsored Ultra
 * Implementation lives in ultra-swap.ts; this hook only supplies wallet,
 * connection, and loading state to that Interface.
 */
export function useJupiterSwap() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [loading, setLoading] = useState<JupiterSwapLoading>(null);
  const [lastOrder, setLastOrder] = useState<UltraOrderResponse | null>(null);

  const swap = useCallback(
    async (args: SwapArgs): Promise<SwapResult> => {
      if (!publicKey || !signTransaction) throw new Error('Wallet not connected');
      return executeJupiterUltraSwap(args, {
        connection,
        publicKey,
        signTransaction: (tx: VersionedTransaction) => signTransaction(tx),
        onLoadingChange: setLoading,
        onOrder: setLastOrder,
      });
    },
    [connection, publicKey, signTransaction],
  );

  return { swap, loading, lastOrder };
}
