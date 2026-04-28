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
  RuntimeExitLeg,
  RuntimeMeta,
} from './types';

/**
 * The single hook every page goes through to perform live-or-demo I/O.
 * Returns a Runtime impl whose strategy is selected by isDemo() once,
 * memoised across renders. Page handlers don't see the demo / live fork.
 */
export function useRuntime(): Runtime {
  const demo = isDemo();
  const authedFetch = useAuthedFetch();
  const { cancelExits, placeExit, replaceExits } = useExitOrders();
  const { swap } = useJupiterSwap();
  const closeDemoPosition = useDemoPositionsStore((s) => s.closePosition);
  const demoPositions = useDemoPositionsStore((s) => s.positions);

  return useMemo<Runtime>(() => {
    if (demo) {
      return {
        isDemo: true,
        cancelExits: async () => {
          // Demo runtime doesn't track exit orders separately — the
          // demo store inlines TP/SL state on the Position itself, so
          // cancel is a no-op here. Caller should still update local
          // store via dismissCancelSibling() etc.
          return [];
        },
        placeExit: async () => ({ id: `demo-${Date.now()}` }),
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
      cancelExits: (positionId: string): Promise<RuntimeExitLeg[]> =>
        cancelExits(positionId),
      placeExit: ({ meta, tokenAmount, triggerPriceUsd, triggerCondition }) =>
        placeExit({
          inputMint: meta.mint,
          inputDecimals: meta.decimals,
          tokenAmount,
          triggerPriceUsd,
          triggerCondition,
        }),
      replaceExits: ({ positionId, meta, tokenAmount, legs }) =>
        replaceExits(positionId, meta, tokenAmount, legs),
      closePosition: async ({
        positionId,
        meta,
        sellProposalId,
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

        // Route through the SELL Proposal persistence path when this close
        // came from a thesis-monitor signal — keeps the Trade row tied to
        // the originating proposal for back-eval attribution.
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
  }, [demo, authedFetch, cancelExits, placeExit, replaceExits, swap, closeDemoPosition, demoPositions]);
}

export type { Runtime, RuntimeExitLeg, RuntimeMeta, RuntimeCloseResult };
