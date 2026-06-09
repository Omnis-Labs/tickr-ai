'use client';

import { useMemo } from 'react';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { emitDevDiagnostic } from '@/lib/dev-tools/client-diagnostics';
import { useExitOrders } from '@/lib/jupiter/use-exit-orders';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { readPortfolioSummaryEvidence } from '@/lib/portfolio/diagnostics';
import type {
  Runtime,
  RuntimeCloseResult,
  RuntimeExitSnapshot,
  RuntimeMeta,
} from './types';
import { closePositionDiagnosticResponse } from './close-position-diagnostics';

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
        ticker,
        meta,
        tokenAmount,
        sellProposalId,
      }: {
        positionId: string;
        ticker?: string | null;
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
        const settlementBody = (await res.json().catch(() => null)) as
          | Record<string, unknown>
          | null;
        const settlement = {
          closeOrderId:
            typeof settlementBody?.closeOrderId === 'string' ? settlementBody.closeOrderId : null,
          cancelledExitOrderIds: Array.isArray(settlementBody?.cancelledExitOrderIds)
            ? settlementBody.cancelledExitOrderIds.filter(
                (id): id is string => typeof id === 'string',
              )
            : [],
        };
        const diagnosticResponse = closePositionDiagnosticResponse({
          positionId,
          ticker: ticker ?? null,
          decimals: meta.decimals,
          requestedTokenAmount: tokenAmount ?? null,
          swap: sell,
          settlement,
        });
        const portfolioSummary = await readPortfolioSummaryEvidence(authedFetch);
        emitDevDiagnostic({
          id: `${positionId}:close-position-settled:${Date.now()}`,
          section: 'swap',
          step: 'position.close.settled',
          summary: `Closed ${ticker ?? 'position'} with a position-scoped Ultra sell.`,
          severity: 'success',
          diagnostics: [
            {
              hypothesis: 'Position-scoped close amount',
              status:
                diagnosticResponse.executionEvidence.positionScope === 'position_token_amount'
                  ? 'healthy'
                  : 'watch',
              detail: `requestedRaw=${diagnosticResponse.executionEvidence.requestedRawAmount ?? 'n/a'}, walletRaw=${diagnosticResponse.executionEvidence.walletRawAmount ?? 'n/a'}, submittedRaw=${diagnosticResponse.executionEvidence.submittedRawAmount}.`,
            },
            {
              hypothesis: 'Portfolio Summary after close',
              status: 'error' in portfolioSummary ? 'watch' : 'healthy',
              detail:
                'error' in portfolioSummary
                  ? portfolioSummary.error
                  : `cash=${portfolioSummary.cashUsd}, active=${portfolioSummary.activePositions}, realized=${portfolioSummary.realizedPnl}, unrealized=${portfolioSummary.unrealizedPnl}, total=${portfolioSummary.totalValue}.`,
            },
          ],
          latencyMs: 0,
          payload: {
            positionId,
            ticker: ticker ?? null,
            requestedTokenAmount: tokenAmount ?? null,
          },
          response: {
            ...diagnosticResponse,
            portfolioSummary,
          },
        });

        return { executionPrice, tokenAmount: tokenAmt, txSignature };
      },
    }),
    [authedFetch, cancelExits, placeOcoExit, replaceExits, swap],
  );
}

export type { Runtime, RuntimeExitSnapshot, RuntimeMeta, RuntimeCloseResult };
