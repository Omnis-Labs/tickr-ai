'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  USDC_DECIMALS,
  XSTOCKS,
  xStockToBare,
  type Proposal,
  type Signal,
  type TriggerHitPayload,
  type XStockTicker,
} from '@hunch-it/shared';
import {
  useSharedWorker,
  type PositionUpdatedPayload,
} from '@/lib/shared-worker/use-shared-worker';
import { useSignalsStore } from '@/lib/store/signals';
import { useProposalsStore } from '@/lib/store/proposals';
import { JupiterSwapError, useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { diagnosticsFromSwapDebug } from '@/lib/jupiter/swap-diagnostics';
import { useAuthedFetch } from '@/lib/auth/fetch';
import {
  compactDiagnosticError,
  decodeSolanaError,
  emitDevDiagnostic,
} from '@/lib/dev-tools/client-diagnostics';
import { QK } from '@/lib/hooks/queries';
import { runEffects } from '@/lib/notifications/effects';
import {
  claimOrderExecution,
  isOrderAlreadyExecuting,
  isOrderAlreadyHandled,
  OrderExecutionClaimError,
  releaseOrderExecutionClaim,
} from '@/lib/orders/execution-claim';
import { isLiveProposal } from '@/lib/proposals/expiration';
import {
  positionUpdatedHandler,
  proposalNewHandler,
  setNavigator,
} from '@/lib/notifications/registry';
import { clearAlertFavicon } from './favicon-dot';
import { stopTitleFlash } from './tab-title-flasher';

function dismissTriggerToasts(orderId: string): void {
  toast.dismiss(orderId);
  toast.dismiss(`${orderId}:success`);
  toast.dismiss(`${orderId}:error`);
  toast.dismiss(`${orderId}:settle-error`);
  toast.dismiss(`${orderId}:executing`);
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function errorDetail(err: unknown): Record<string, unknown> {
  if (err instanceof JupiterSwapError) {
    return {
      name: err.name,
      message: err.message,
      decodedSolanaError: decodeSolanaError(`${err.message}\n${err.debug.originalMessage}`),
      swap: err.debug,
      originalError: compactDiagnosticError(err.originalError),
    };
  }
  if (err instanceof OrderExecutionClaimError) {
    return {
      name: err.name,
      message: err.message,
      reason: err.reason,
      statusCode: err.statusCode,
    };
  }
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      decodedSolanaError: decodeSolanaError(err.message),
    };
  }
  return { message: String(err) };
}

function triggerDiagnosticPayload(
  payload: TriggerHitPayload,
  mint: string,
  decimals: number,
): Record<string, unknown> {
  return {
    orderId: payload.orderId,
    positionId: payload.positionId,
    kind: payload.kind,
    side: payload.side,
    ticker: payload.ticker,
    mint,
    decimals,
    triggerPriceUsd: payload.triggerPriceUsd,
    currentPriceUsd: payload.currentPriceUsd,
    sizeUsd: payload.sizeUsd,
    tokenAmount: payload.tokenAmount ?? null,
  };
}

/**
 * Driver-only: subscribes to socket events, hands payloads to typed
 * handlers in lib/notifications/registry.ts, runs the returned UIEffects.
 * Per-event UI logic lives in the registry — adding a new event type =
 * one new handler entry.
 */
export function NotificationClient() {
  const router = useRouter();
  const addSignal = useSignalsStore((s) => s.addSignal);
  const upsertProposal = useProposalsStore((s) => s.upsertProposal);
  const removeProposal = useProposalsStore((s) => s.removeProposal);
  const clearExpiredProposals = useProposalsStore((s) => s.clearExpired);
  const activeNotifs = useRef<Map<string, Notification>>(new Map());
  const { swap } = useJupiterSwap();
  const authedFetch = useAuthedFetch();
  const qc = useQueryClient();
  // Track in-flight executions per orderId so a re-fired trigger:hit
  // event (the monitor re-emits while the order stays OPEN) or a
  // double-tap can't kick off a duplicate Ultra swap. settledTriggers
  // suppresses stale trigger events that arrive after /execute filled
  // the order and before the monitor observes the new DB state.
  const inflightTriggers = useRef<Set<string>>(new Set());
  const settledTriggers = useRef<Set<string>>(new Set());

  const emitTriggerDiagnostic = useCallback(
    (input: Parameters<typeof emitDevDiagnostic>[0]) => {
      return emitDevDiagnostic(input);
    },
    [],
  );

  // The registry's navigateTo() needs a router; patch it on mount.
  useEffect(() => {
    setNavigator((href) => router.push(href));
  }, [router]);

  useEffect(() => {
    clearExpiredProposals();
    const interval = window.setInterval(clearExpiredProposals, 15_000);
    return () => window.clearInterval(interval);
  }, [clearExpiredProposals]);

  const handleProposal = useCallback(
    (proposal: Proposal) => {
      if (!isLiveProposal(proposal)) {
        removeProposal(proposal.id);
        return;
      }
      upsertProposal(proposal);
      const isHidden = typeof document !== 'undefined' && document.hidden;
      const effects = proposalNewHandler(proposal, { isHidden });
      runEffects(effects, {
        navigate: (href) => router.push(href),
        activeNotifs: activeNotifs.current,
      });
    },
    [removeProposal, router, upsertProposal],
  );

  const handleSignal = useCallback(
    (signal: Signal) => {
      // Legacy v1.2 emitter — store-only; v1.3 proposal flow owns the modal.
      addSignal(signal);
    },
    [addSignal],
  );

  const handlePositionUpdated = useCallback(
    (payload: PositionUpdatedPayload) => {
      const effects = positionUpdatedHandler(payload);
      runEffects(effects, {
        navigate: (href) => router.push(href),
        activeNotifs: activeNotifs.current,
      });
    },
    [router],
  );

  // Tap-to-execute for synthetic xStock triggers. The ws-server's price
  // monitor emits trigger:hit when an OPEN order's condition matches Pyth;
  // we surface a sticky toast and run the Ultra swap on tap, then settle
  // via /api/orders/[id]/execute. Idempotent: same orderId may re-fire
  // while the user deliberates, but `id: orderId` on the toast de-dupes
  // and inflightTriggers blocks a concurrent second swap.
  const runTriggerExecute = useCallback(
    async (payload: TriggerHitPayload, mint: string, decimals: number): Promise<void> => {
      if (settledTriggers.current.has(payload.orderId)) return;
      if (inflightTriggers.current.has(payload.orderId)) return;
      inflightTriggers.current.add(payload.orderId);
      const verb = payload.kind === 'BUY_TRIGGER' ? 'BUY' : 'SELL';
      const startedAt = performance.now();
      const diagnosticPayload = triggerDiagnosticPayload(payload, mint, decimals);
      toast.dismiss(`${payload.orderId}:success`);
      toast.dismiss(`${payload.orderId}:error`);
      toast.dismiss(`${payload.orderId}:settle-error`);
      toast.dismiss(`${payload.orderId}:executing`);
      toast.loading(`Executing ${verb} ${payload.ticker}…`, {
        id: payload.orderId,
        duration: Infinity,
      });
      emitTriggerDiagnostic({
        id: `${payload.orderId}:trigger-execute-start:${Date.now()}`,
        section: 'swap',
        step: 'trigger.execute.start',
        summary: `Toast execution started for ${payload.kind} ${payload.ticker}.`,
        severity: 'info',
        diagnostics: [
          {
            hypothesis: 'Forced-trigger execution path',
            status: 'healthy',
            detail:
              'This event came from NotificationClient toast Execute/Retry, not manual /dev-tools Execute swap.',
          },
        ],
        latencyMs: 0,
        payload: diagnosticPayload,
      });

      let claimed = false;
      let swapBroadcast = false;
      try {
        await claimOrderExecution(authedFetch, payload.orderId);
        claimed = true;
        emitTriggerDiagnostic({
          id: `${payload.orderId}:trigger-claim:${Date.now()}`,
          section: 'orders',
          step: 'trigger.claimExecution',
          summary: `Execution claim acquired for ${shortId(payload.orderId)}.`,
          severity: 'success',
          diagnostics: [
            {
              hypothesis: 'Execution claim lock',
              status: 'healthy',
              detail: 'Claim acquired before requesting Jupiter order.',
            },
          ],
          latencyMs: Math.round(performance.now() - startedAt),
          payload: diagnosticPayload,
        });
        console.info('[trigger-execute] claimed', {
          orderId: payload.orderId,
          positionId: payload.positionId,
          kind: payload.kind,
          ticker: payload.ticker,
          mint,
          sizeUsd: payload.sizeUsd,
          tokenAmount: payload.tokenAmount ?? null,
        });

        // For TP/SL we sell exactly the position's token count
        // (populated on the synthetic exit Order at BUY-fill time and
        // forwarded via TriggerHitPayload.tokenAmount). Falling back to
        // sellAll would sweep unrelated dust or another position
        // sharing the same mint — see the manual-close side-effect we
        // hit on 2026-05-02 where the close sold double the DB amount.
        const swapDiagnostics = { source: 'trigger-toast', mode: 'probes' } as const;
        const result =
          payload.kind === 'BUY_TRIGGER'
            ? await swap({
                direction: 'BUY',
                xStockMint: mint,
                xStockDecimals: decimals,
                usdAmount: payload.sizeUsd,
                diagnostics: swapDiagnostics,
              })
            : payload.tokenAmount && payload.tokenAmount > 0
              ? await swap({
                  direction: 'SELL',
                  xStockMint: mint,
                  xStockDecimals: decimals,
                  tokenAmount: payload.tokenAmount,
                  diagnostics: swapDiagnostics,
                })
              : await swap({
                  direction: 'SELL',
                  xStockMint: mint,
                  xStockDecimals: decimals,
                  sellAll: true,
                  diagnostics: swapDiagnostics,
                });

        if (result.exec.status !== 'Success') {
          throw new Error(result.exec.error ?? 'swap failed');
        }
        swapBroadcast = true;

        const tokenAmount =
          payload.kind === 'BUY_TRIGGER'
            ? Number(result.outputAmount) / 10 ** decimals
            : Number(result.inputAmount) / 10 ** decimals;
        const usdValue =
          payload.kind === 'BUY_TRIGGER'
            ? Number(result.inputAmount) / 10 ** USDC_DECIMALS
            : Number(result.outputAmount) / 10 ** USDC_DECIMALS;
        const executionPrice = tokenAmount > 0 ? usdValue / tokenAmount : payload.currentPriceUsd;

        const settle = await authedFetch(`/api/orders/${payload.orderId}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            txSignature: result.exec.signature ?? `unknown-${Date.now()}`,
            executionPrice,
            tokenAmount,
          }),
        });
        if (!settle.ok) {
          const body = (await settle.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `settle ${settle.status}`);
        }

        settledTriggers.current.add(payload.orderId);
        emitTriggerDiagnostic({
          id: `${payload.orderId}:trigger-settled:${Date.now()}`,
          section: 'swap',
          step: 'trigger.executeSwap',
          summary: `Toast swap broadcast ${shortId(result.exec.signature ?? 'unknown')} and settled at $${executionPrice.toFixed(2)}.`,
          severity: 'success',
          diagnostics: diagnosticsFromSwapDebug(result.debug),
          latencyMs: Math.round(performance.now() - startedAt),
          payload: diagnosticPayload,
          response: {
            swap: result.exec,
            diagnostics: result.debug,
            executionPrice,
            tokenAmount,
          },
        });
        dismissTriggerToasts(payload.orderId);
        toast.success(`${verb} ${payload.ticker} confirmed`, {
          id: `${payload.orderId}:success`,
          description: `${tokenAmount.toFixed(4)} @ $${executionPrice.toFixed(2)}`,
          duration: 8_000,
        });
        console.info('[trigger-execute] settled', {
          orderId: payload.orderId,
          positionId: payload.positionId,
          kind: payload.kind,
          ticker: payload.ticker,
          signature: result.exec.signature ?? null,
          jupiterRequestId: result.order.requestId,
          tokenAmount,
          usdValue,
          executionPrice,
        });
        void qc.invalidateQueries({ queryKey: QK.orders() });
        void qc.invalidateQueries({ queryKey: QK.positions() });
        void qc.invalidateQueries({ queryKey: QK.position(payload.positionId) });
        void qc.invalidateQueries({ queryKey: QK.portfolio() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const detail = errorDetail(err);
        const swapDebug = err instanceof JupiterSwapError ? err.debug : null;
        const decoded =
          err instanceof JupiterSwapError
            ? decodeSolanaError(`${err.message}\n${err.debug.originalMessage}`)
            : decodeSolanaError(msg);
        emitTriggerDiagnostic({
          id: `${payload.orderId}:trigger-failed:${Date.now()}`,
          section: 'swap',
          step: 'trigger.executeSwap',
          summary: swapDebug
            ? `Toast swap failed during ${swapDebug.phase}: ${swapDebug.originalMessage || msg}`
            : `Toast execution failed: ${msg}`,
          severity: 'error',
          diagnostics: [
            ...(swapDebug ? diagnosticsFromSwapDebug(swapDebug) : []),
            ...(decoded
              ? [
                  {
                    hypothesis: 'Program execution reached?',
                    status:
                      decoded.code === -32002 &&
                      decoded.context.logs === '[]' &&
                      (decoded.context.unitsConsumed === '0n' ||
                        decoded.context.unitsConsumed === '0')
                        ? 'risk'
                        : 'watch',
                    detail: `${decoded.classifier}; logs=${decoded.context.logs ?? 'n/a'}, units=${decoded.context.unitsConsumed ?? 'n/a'}.`,
                  } as const,
                ]
              : []),
            {
              hypothesis: 'Claim cleanup',
              status: claimed && !swapBroadcast ? 'watch' : 'unknown',
              detail:
                claimed && !swapBroadcast
                  ? 'Swap did not broadcast, so the order claim will be released for retry.'
                  : `claimed=${claimed}, swapBroadcast=${swapBroadcast}.`,
            },
          ],
          latencyMs: Math.round(performance.now() - startedAt),
          payload: diagnosticPayload,
          error: msg,
          errorDetail: {
            claimed,
            swapBroadcast,
            ...detail,
          },
        });
        console.error('[trigger-execute] failed', {
          orderId: payload.orderId,
          positionId: payload.positionId,
          kind: payload.kind,
          ticker: payload.ticker,
          mint,
          decimals,
          claimed,
          swapBroadcast,
          payload,
          error: detail,
        });
        if (err instanceof OrderExecutionClaimError) {
          if (isOrderAlreadyHandled(err.reason)) {
            settledTriggers.current.add(payload.orderId);
            dismissTriggerToasts(payload.orderId);
            void qc.invalidateQueries({ queryKey: QK.orders() });
            void qc.invalidateQueries({ queryKey: QK.positions() });
            void qc.invalidateQueries({ queryKey: QK.position(payload.positionId) });
            void qc.invalidateQueries({ queryKey: QK.portfolio() });
            return;
          }
          if (isOrderAlreadyExecuting(err.reason)) {
            dismissTriggerToasts(payload.orderId);
            toast(`${verb} ${payload.ticker} already executing…`, {
              id: `${payload.orderId}:executing`,
              duration: 4_000,
            });
            return;
          }
        }

        if (claimed && !swapBroadcast) {
          await releaseOrderExecutionClaim(authedFetch, payload.orderId).catch((releaseErr) => {
            console.warn('[notifications] release execution claim failed', releaseErr);
          });
        }

        if (swapBroadcast) {
          dismissTriggerToasts(payload.orderId);
          toast.error(`Swap broadcast, but settle failed: ${msg}`, {
            id: `${payload.orderId}:settle-error`,
            description: 'Refresh the order state before retrying.',
            duration: 12_000,
          });
          void qc.invalidateQueries({ queryKey: QK.orders() });
          void qc.invalidateQueries({ queryKey: QK.positions() });
          void qc.invalidateQueries({ queryKey: QK.position(payload.positionId) });
          void qc.invalidateQueries({ queryKey: QK.portfolio() });
          return;
        }

        dismissTriggerToasts(payload.orderId);
        toast.error(`Execute failed: ${msg}`, {
          id: `${payload.orderId}:error`,
          description: 'The swap did not broadcast; you can retry this trigger.',
          duration: 12_000,
          action: {
            label: 'Retry',
            onClick: () => {
              void runTriggerExecute(payload, mint, decimals);
            },
          },
        });
      } finally {
        inflightTriggers.current.delete(payload.orderId);
      }
    },
    [authedFetch, emitTriggerDiagnostic, qc, swap],
  );

  const handleTriggerHit = useCallback(
    (payload: TriggerHitPayload) => {
      if (settledTriggers.current.has(payload.orderId)) return;
      const meta = XSTOCKS[xStockToBare(payload.ticker as XStockTicker)];
      if (!meta?.mint) {
        toast.error(
          `${payload.ticker} mint missing — run \`pnpm --filter @hunch-it/ws-server verify:xstocks\`.`,
          { id: payload.orderId },
        );
        return;
      }
      // While a swap is mid-flight, ignore re-emits — the loading toast
      // already has the order's id and would just be replaced anyway.
      if (inflightTriggers.current.has(payload.orderId)) return;

      const verb = payload.kind === 'BUY_TRIGGER' ? 'BUY' : 'SELL';
      const triggerLabel =
        payload.kind === 'BUY_TRIGGER'
          ? `Trigger $${payload.triggerPriceUsd.toFixed(2)} hit. Tap to execute.`
          : `${payload.kind === 'TAKE_PROFIT' ? 'TP' : 'SL'} $${payload.triggerPriceUsd.toFixed(2)} hit. Tap to execute.`;
      emitTriggerDiagnostic({
        id: `${payload.orderId}:trigger-hit:${Date.now()}`,
        section: 'orders',
        step: 'trigger.hit',
        summary: `${payload.kind} ${payload.ticker} trigger toast shown at $${payload.currentPriceUsd.toFixed(2)}.`,
        severity: 'info',
        diagnostics: [
          {
            hypothesis: 'Forced-trigger event delivery',
            status: 'healthy',
            detail:
              'Shared worker delivered trigger:hit and NotificationClient showed the Execute toast.',
          },
        ],
        latencyMs: 0,
        payload: triggerDiagnosticPayload(payload, meta.mint, meta.decimals),
      });

      toast.dismiss(`${payload.orderId}:error`);
      toast.dismiss(`${payload.orderId}:settle-error`);
      toast.dismiss(`${payload.orderId}:executing`);
      toast(`${verb} ${payload.ticker} @ $${payload.currentPriceUsd.toFixed(2)}`, {
        id: payload.orderId,
        description: triggerLabel,
        duration: Infinity,
        action: {
          label: 'Execute',
          onClick: () => {
            void runTriggerExecute(payload, meta.mint, meta.decimals);
          },
        },
      });
    },
    [emitTriggerDiagnostic, runTriggerExecute],
  );

  useSharedWorker({
    onProposal: handleProposal,
    onSignal: handleSignal,
    onPositionUpdated: handlePositionUpdated,
    onTriggerHit: handleTriggerHit,
  });

  // Stop attention UI + close stale OS notifications when the user returns.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) return;
      stopTitleFlash();
      clearAlertFavicon();
      for (const n of activeNotifs.current.values()) {
        try {
          n.close();
        } catch {
          /* noop */
        }
      }
      activeNotifs.current.clear();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, []);

  return null;
}
