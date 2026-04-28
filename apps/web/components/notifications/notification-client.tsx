'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { DemoProposalShape, Signal } from '@hunch-it/shared';
import {
  useSharedWorker,
  type PositionUpdatedPayload,
} from '@/lib/shared-worker/use-shared-worker';
import { useSignalsStore } from '@/lib/store/signals';
import { useProposalsStore } from '@/lib/store/proposals';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
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

  useSharedWorker({
    onProposal: handleProposal,
    onSignal: handleSignal,
    onPositionUpdated: handlePositionUpdated,
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
