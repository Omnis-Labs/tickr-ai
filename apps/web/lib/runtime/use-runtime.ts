'use client';

import { useMemo } from 'react';
import { isDemo } from '@/lib/demo';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useExitOrders } from '@/lib/jupiter/use-exit-orders';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import type {
  Runtime,
  RuntimeCloseResult,
  RuntimeExitSnapshot,
  RuntimeMeta,
} from './types';

/**
 * Single hook every page goes through to perform live-or-demo I/O.
 * Returns a Runtime whose strategy is selected by isDemo() once and
 * memoised across renders. Page handlers don't see the demo / live fork.
 */
export function useRuntime(): Runtime {
  const demo = isDemo();
  const authedFetch = useAuthedFetch();
  const { cancelExits, placeOcoExit, replaceExits } = useExitOrders();
  const { swap } = useJupiterSwap();
  const closeDemoPosition = useDemoPositionsStore((s) => s.closePosition);
  const demoPositions = useDemoPositionsStore((s) => s.positions);

  return useMemo<Runtime>(() => {
    if (demo) {
      return {
        isDemo: true,
        cancelExits: async (): Promise<RuntimeExitSnapshot> => {
          // Demo store inlines TP/SL on Position itself, so cancel is a
          // no-op. Caller still updates local store via dismissCancelSibling().
          return { tpPriceUsd: null, slPriceUsd: null };
        },
        placeOcoExit: async () => ({ id: `demo-${Date.now()}` }),
        replaceExits: async () => {
          /* demo store has no separate exit orders; Position Detail
           *  also calls adjustTpSl() in the demo branch directly */
        },
        closePosition: async ({ positionId, fallbackMarkPrice }): Promise<RuntimeCloseResult> => {
          await new Promise((r) => setTimeout(r, 600));
          const pos = demoPositions.find((p) => p.id === positionId);
          const tokenAmount = pos?.tokenAmount ?? 0;
          closeDemoPosition(positionId, 'USER_CLOSE', fallbackMarkPrice);
          return {
            executionPrice: fallbackMarkPrice,
            tokenAmount,
            txSignature: null,
          };
        },
      };
    }

    return {
      isDemo: false,
      cancelExits: (positionId: string): Promise<RuntimeExitSnapshot> =>
        cancelExits(positionId),
      placeOcoExit: async ({ meta, tokenAmount, tpPriceUsd, slPriceUsd }) => {
        const r = await placeOcoExit({
          inputMint: meta.mint,
          inputDecimals: meta.decimals,
          tokenAmount,
          tpPriceUsd,
          slPriceUsd,
        });
        return { id: r.id };
      },
      replaceExits: ({ positionId, meta, tokenAmount, next }) =>
        replaceExits(positionId, meta, tokenAmount, next),
      closePosition: async ({
        positionId,
        meta,
        sellProposalId,
      }: {
        positionId: string;
        meta: RuntimeMeta;
        fallbackMarkPrice: number;
        sellProposalId?: string;
      }): Promise<RuntimeCloseResult> => {
        await cancelExits(positionId);
        const sell = await swap({
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

        await authedFetch(persistUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            executionPrice,
            tokenAmount: tokenAmt,
            txSignature,
          }),
        }).catch(() => {});

        return { executionPrice, tokenAmount: tokenAmt, txSignature };
      },
    };
  }, [demo, authedFetch, cancelExits, placeOcoExit, replaceExits, swap, closeDemoPosition, demoPositions]);
}

export type { Runtime, RuntimeExitSnapshot, RuntimeMeta, RuntimeCloseResult };
