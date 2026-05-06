'use client';

import { useMemo } from 'react';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useExitOrders } from '@/lib/jupiter/use-exit-orders';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import type {
  Runtime,
  RuntimeCloseResult,
  RuntimeExitSnapshot,
  RuntimeMeta,
} from './types';

/**
 * Runtime façade for the synthetic-trigger product path. A password-gated
 * dev-tools surface now exercises this same database and swap flow.
 */
export function useRuntime(): Runtime {
  const authedFetch = useAuthedFetch();
  const { cancelExits, placeOcoExit, replaceExits } = useExitOrders();
  const { swap } = useJupiterSwap();

  return useMemo<Runtime>(
    () => ({
      cancelExits: (positionId: string): Promise<RuntimeExitSnapshot> =>
        cancelExits(positionId),
      placeOcoExit: async ({
        positionId,
        walletAddress,
        ticker,
        tokenAmount,
        tpPriceUsd,
        slPriceUsd,
      }) => {
        const r = await placeOcoExit({
          positionId,
          walletAddress,
          ticker,
          tokenAmount,
          tpPriceUsd,
          slPriceUsd,
        });
        return { id: r.id };
      },
      replaceExits: ({ positionId, next }) => replaceExits({ positionId, next }),
      closePosition: async ({
        positionId,
        meta,
        tokenAmount,
        sellProposalId,
      }: {
        positionId: string;
        meta: RuntimeMeta;
        fallbackMarkPrice: number;
        tokenAmount?: number | null;
        sellProposalId?: string;
      }): Promise<RuntimeCloseResult> => {
        if (sellProposalId) {
          await cancelExits(positionId);
        }
        const sell =
          tokenAmount && tokenAmount > 0
            ? await swap({
                direction: 'SELL',
                xStockMint: meta.mint,
                xStockDecimals: meta.decimals,
                tokenAmount,
              })
            : await swap({
                direction: 'SELL',
                xStockMint: meta.mint,
                xStockDecimals: meta.decimals,
                sellAll: true,
              });
        const tokenAmt = Number(sell.inputAmount) / 10 ** meta.decimals;
        const usdOut = Number(sell.outputAmount) / 1_000_000;
        const executionPrice = tokenAmt > 0 ? usdOut / tokenAmt : null;
        const txSignature = sell.exec.signature ?? null;

        const persistUrl = sellProposalId
          ? `/api/proposals/${sellProposalId}/sell-confirm`
          : `/api/positions/${positionId}/close`;

        const res = await authedFetch(persistUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            executionPrice,
            tokenAmount: tokenAmt,
            txSignature,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `close persist ${res.status}`);
        }

        return { executionPrice, tokenAmount: tokenAmt, txSignature };
      },
    }),
    [authedFetch, cancelExits, placeOcoExit, replaceExits, swap],
  );
}

export type { Runtime, RuntimeExitSnapshot, RuntimeMeta, RuntimeCloseResult };
