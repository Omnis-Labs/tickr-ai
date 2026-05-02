'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  USDC_DECIMALS,
  XSTOCKS,
  xStockToBare,
  type DemoProposalShape,
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
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { QK } from '@/lib/hooks/queries';
import { runEffects } from '@/lib/notifications/effects';
import {
  positionUpdatedHandler,
  proposalNewHandler,
  setNavigator,
} from '@/lib/notifications/registry';
import { clearAlertFavicon } from './favicon-dot';
import { stopTitleFlash } from './tab-title-flasher';

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
  const activeNotifs = useRef<Map<string, Notification>>(new Map());
  const { swap } = useJupiterSwap();
  const authedFetch = useAuthedFetch();
  const qc = useQueryClient();
  // Track in-flight executions per orderId so a re-fired trigger:hit
  // event (the monitor re-emits while the order stays OPEN) or a
  // double-tap can't kick off a duplicate Ultra swap.
  const inflightTriggers = useRef<Set<string>>(new Set());

  // The registry's navigateTo() needs a router; patch it on mount.
  useEffect(() => {
    setNavigator((href) => router.push(href));
  }, [router]);

  const handleProposal = useCallback(
    (proposal: DemoProposalShape) => {
      upsertProposal(proposal);
      const isHidden = typeof document !== 'undefined' && document.hidden;
      const effects = proposalNewHandler(proposal, { isHidden });
      runEffects(effects, {
        navigate: (href) => router.push(href),
        activeNotifs: activeNotifs.current,
      });
    },
    [router, upsertProposal],
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
      // Cross-store side effect: surface the cancel-sibling banner via the
      // demo positions store so Position Detail picks it up consistently
      // across demo + live runtimes.
      if (payload.action === 'cancel-sibling' && payload.siblingKind) {
        useDemoPositionsStore.setState((s) => ({
          cancelSiblingHints: {
            ...s.cancelSiblingHints,
            [payload.positionId]: {
              siblingKind: payload.siblingKind === 'TAKE_PROFIT' ? 'TP' : 'SL',
              createdAt: new Date().toISOString(),
            },
          },
        }));
      }
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
    async (
      payload: TriggerHitPayload,
      mint: string,
      decimals: number,
    ): Promise<void> => {
      if (inflightTriggers.current.has(payload.orderId)) return;
      inflightTriggers.current.add(payload.orderId);
      const verb = payload.kind === 'BUY_TRIGGER' ? 'BUY' : 'SELL';
      toast.loading(`Executing ${verb} ${payload.ticker}…`, {
        id: payload.orderId,
        duration: Infinity,
      });

      try {
        // For TP/SL we sell exactly the position's token count
        // (populated on the synthetic exit Order at BUY-fill time and
        // forwarded via TriggerHitPayload.tokenAmount). Falling back to
        // sellAll would sweep unrelated dust or another position
        // sharing the same mint — see the manual-close side-effect we
        // hit on 2026-05-02 where the close sold double the DB amount.
        const result =
          payload.kind === 'BUY_TRIGGER'
            ? await swap({
                direction: 'BUY',
                xStockMint: mint,
                xStockDecimals: decimals,
                usdAmount: payload.sizeUsd,
              })
            : payload.tokenAmount && payload.tokenAmount > 0
              ? await swap({
                  direction: 'SELL',
                  xStockMint: mint,
                  xStockDecimals: decimals,
                  tokenAmount: payload.tokenAmount,
                })
              : await swap({
                  direction: 'SELL',
                  xStockMint: mint,
                  xStockDecimals: decimals,
                  sellAll: true,
                });

        if (result.exec.status !== 'Success') {
          throw new Error(result.exec.error ?? 'swap failed');
        }

        const tokenAmount =
          payload.kind === 'BUY_TRIGGER'
            ? Number(result.outputAmount) / 10 ** decimals
            : Number(result.inputAmount) / 10 ** decimals;
        const usdValue =
          payload.kind === 'BUY_TRIGGER'
            ? Number(result.inputAmount) / 10 ** USDC_DECIMALS
            : Number(result.outputAmount) / 10 ** USDC_DECIMALS;
        const executionPrice =
          tokenAmount > 0 ? usdValue / tokenAmount : payload.currentPriceUsd;

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

        toast.success(`${verb} ${payload.ticker} confirmed`, {
          id: payload.orderId,
          description: `${tokenAmount.toFixed(4)} @ $${executionPrice.toFixed(2)}`,
          duration: 8_000,
        });
        void qc.invalidateQueries({ queryKey: QK.orders() });
        void qc.invalidateQueries({ queryKey: QK.positions() });
        void qc.invalidateQueries({ queryKey: QK.position(payload.positionId) });
        void qc.invalidateQueries({ queryKey: QK.portfolio() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Execute failed: ${msg}`, {
          id: payload.orderId,
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
    [swap, authedFetch, qc],
  );

  const handleTriggerHit = useCallback(
    (payload: TriggerHitPayload) => {
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
    [runTriggerExecute],
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
