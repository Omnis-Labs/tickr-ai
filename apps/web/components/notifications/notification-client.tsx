'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  getAssetById,
  type Proposal,
  type Signal,
  type TradeFilledPayload,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import { useSharedWorker } from '@/lib/shared-worker/use-shared-worker';
import { useSignalsStore } from '@/lib/store/signals';
import { useProposalsStore } from '@/lib/store/proposals';
import { useOrdersStore } from '@/lib/store/orders';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { emitDevDiagnostic } from '@/lib/dev-tools/client-diagnostics';
import { QK } from '@/lib/hooks/queries';
import { runEffects } from '@/lib/notifications/effects';
import { executeTriggerOrder, triggerDiagnosticPayload } from '@/lib/orders/trigger-execution';
import { isLiveProposal } from '@/lib/proposals/expiration';
import { normalizeProposalForClient } from '@/lib/proposals/normalize';
import { proposalNewHandler, setNavigator } from '@/lib/notifications/registry';
import { clearAlertFavicon } from './favicon-dot';
import { stopTitleFlash } from './tab-title-flasher';

function dismissTriggerToasts(orderId: string): void {
  toast.dismiss(orderId);
  toast.dismiss(`${orderId}:success`);
  toast.dismiss(`${orderId}:error`);
  toast.dismiss(`${orderId}:settle-error`);
  toast.dismiss(`${orderId}:executing`);
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
  const pushOrderHint = useOrdersStore((s) => s.pushHint);
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

  const emitTriggerDiagnostic = useCallback((input: Parameters<typeof emitDevDiagnostic>[0]) => {
    return emitDevDiagnostic(input);
  }, []);

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
    (incoming: Proposal) => {
      const proposal = normalizeProposalForClient(incoming);
      if (!proposal) return;
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

  const handleTradeFilled = useCallback(
    (payload: TradeFilledPayload) => {
      settledTriggers.current.add(payload.orderId);
      dismissTriggerToasts(payload.orderId);
      pushOrderHint({
        orderId: payload.orderId,
        status: 'FILLED',
        receivedAt: new Date().toISOString(),
      });
      const verb = payload.kind === 'BUY_TRIGGER' ? 'BUY' : 'SELL';
      toast.success(`Auto-executed ${verb} ${payload.ticker}`, {
        id: `${payload.orderId}:success`,
        description: `${payload.tokenAmount.toFixed(4)} @ $${payload.executionPrice.toFixed(2)}`,
        duration: 8_000,
      });
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.position(payload.positionId) });
      void qc.invalidateQueries({ queryKey: QK.portfolio() });
    },
    [pushOrderHint, qc],
  );

  // Tap-to-execute for synthetic xStock triggers. The ws-server emits
  // trigger:hit only after Pyth wakes the Order and a fresh Ultra quote
  // satisfies the executable trigger condition. We surface a sticky toast
  // and run the Ultra swap on tap, then settle via /api/orders/[id]/execute.
  // Idempotent: same orderId may re-fire
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

      try {
        const outcome = await executeTriggerOrder(
          { payload, mint, decimals, startedAt },
          {
            authedFetch,
            swap,
            emitDiagnostic: emitTriggerDiagnostic,
          },
        );

        if (outcome.kind === 'settled') {
          settledTriggers.current.add(payload.orderId);
          dismissTriggerToasts(payload.orderId);
          toast.success(`${verb} ${payload.ticker} confirmed`, {
            id: `${payload.orderId}:success`,
            description: `${outcome.tokenAmount.toFixed(4)} @ $${outcome.executionPrice.toFixed(2)}`,
            duration: 8_000,
          });
          console.info('[trigger-execute] settled', {
            orderId: payload.orderId,
            positionId: payload.positionId,
            kind: payload.kind,
            ticker: payload.ticker,
            signature: outcome.signature,
            jupiterRequestId: outcome.jupiterRequestId,
            tokenAmount: outcome.tokenAmount,
            usdValue: outcome.usdValue,
            executionPrice: outcome.executionPrice,
          });
          void qc.invalidateQueries({ queryKey: QK.orders() });
          void qc.invalidateQueries({ queryKey: QK.positions() });
          void qc.invalidateQueries({ queryKey: QK.position(payload.positionId) });
          void qc.invalidateQueries({ queryKey: QK.portfolio() });
          return;
        }

        if (outcome.kind === 'alreadyHandled') {
          settledTriggers.current.add(payload.orderId);
          dismissTriggerToasts(payload.orderId);
          void qc.invalidateQueries({ queryKey: QK.orders() });
          void qc.invalidateQueries({ queryKey: QK.positions() });
          void qc.invalidateQueries({ queryKey: QK.position(payload.positionId) });
          void qc.invalidateQueries({ queryKey: QK.portfolio() });
          return;
        }

        if (outcome.kind === 'alreadyExecuting') {
          dismissTriggerToasts(payload.orderId);
          toast(`${verb} ${payload.ticker} already executing…`, {
            id: `${payload.orderId}:executing`,
            duration: 4_000,
          });
          return;
        }

        if (outcome.kind === 'broadcastButSettleFailed') {
          dismissTriggerToasts(payload.orderId);
          toast.error(`Swap broadcast, but settle failed: ${outcome.message}`, {
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

        const message =
          outcome.kind === 'preBroadcastFailed' || outcome.kind === 'failed'
            ? outcome.message
            : 'Execution failed';
        const retryDescription =
          outcome.kind === 'preBroadcastFailed' && !outcome.released
            ? 'Claim release failed; refresh the order state before retrying.'
            : 'The swap did not broadcast; you can retry this trigger.';

        dismissTriggerToasts(payload.orderId);
        toast.error(`Execute failed: ${message}`, {
          id: `${payload.orderId}:error`,
          description: retryDescription,
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
      const meta = getAssetById(payload.ticker);
      if (!meta?.mint) {
        toast.error(`${payload.ticker} mint missing — check packages/shared/src/assets.ts.`, {
          id: payload.orderId,
        });
        return;
      }
      // While a swap is mid-flight, ignore re-emits — the loading toast
      // already has the order's id and would just be replaced anyway.
      if (inflightTriggers.current.has(payload.orderId)) return;

      const verb = payload.kind === 'BUY_TRIGGER' ? 'BUY' : 'SELL';
      const executablePrice = payload.executablePriceUsd ?? payload.currentPriceUsd;
      const executableLabel = `Executable $${executablePrice.toFixed(2)}`;
      const markLabel = `Pyth $${payload.currentPriceUsd.toFixed(2)}`;
      const triggerLabel =
        payload.kind === 'BUY_TRIGGER'
          ? `Trigger $${payload.triggerPriceUsd.toFixed(2)} met by ${executableLabel}; ${markLabel}.`
          : `${payload.kind === 'TAKE_PROFIT' ? 'TP' : 'SL'} $${payload.triggerPriceUsd.toFixed(2)} met by ${executableLabel}; ${markLabel}.`;
      emitTriggerDiagnostic({
        id: `${payload.orderId}:trigger-hit:${Date.now()}`,
        section: 'orders',
        step: 'trigger.hit',
        summary: `${payload.kind} ${payload.ticker} trigger toast shown at executable $${executablePrice.toFixed(2)}.`,
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
      toast(`${verb} ${payload.ticker} @ $${executablePrice.toFixed(2)}`, {
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
    onTriggerHit: handleTriggerHit,
    onTradeFilled: handleTradeFilled,
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
