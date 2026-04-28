'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { DemoProposalShape, Signal } from '@hunch-it/shared';
import {
  useSharedWorker,
  type PositionUpdatedPayload,
} from '@/lib/shared-worker/use-shared-worker';
import { useSignalsStore } from '@/lib/store/signals';
import { useProposalsStore } from '@/lib/store/proposals';
import { useDemoPositionsStore } from '@/lib/demo/positions';
import { setAlertFavicon, clearAlertFavicon } from './favicon-dot';
import { startTitleFlash, stopTitleFlash } from './tab-title-flasher';
import { playSignalSound } from './sound-manager';

/**
 * Central client component mounted once in the root layout via <Providers>.
 * Receives signals + proposals from the Shared Worker, routes them according
 * to tab state, and owns all attention-getting side effects.
 *
 * v1.3: proposal:new is the primary event. Legacy signal:new remains wired so
 * any non-v1.3 emitter still drops into the same UX, but with low priority.
 */
export function NotificationClient() {
  const router = useRouter();
  const addSignal = useSignalsStore((s) => s.addSignal);
  const upsertProposal = useProposalsStore((s) => s.upsertProposal);
  const activeNotifs = useRef<Map<string, Notification>>(new Map());

  // ─── proposal:new ───────────────────────────────────────────────────────
  const handleProposal = useCallback(
    (proposal: DemoProposalShape) => {
      upsertProposal(proposal);

      if (typeof document === 'undefined') return;
      const isHidden = document.hidden;

      if (!isHidden) {
        // In-app toast on visible tab — don't auto-push fullscreen since
        // proposals have minutes of TTL (not 30s like legacy signals).
        toast(`BUY ${proposal.ticker}`, {
          description: proposal.rationale.slice(0, 140),
          action: {
            label: 'Review',
            onClick: () => router.push(`/proposals/${proposal.id}`),
          },
          duration: 12_000,
        });
        return;
      }

      // Hidden tab: OS notification + attention UI.
      startTitleFlash(`🔔 BUY ${proposal.ticker} — Hunch It`);
      setAlertFavicon();
      playSignalSound();

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification(`Hunch It · BUY ${proposal.ticker}`, {
            body: proposal.rationale.slice(0, 200),
            tag: proposal.id,
            requireInteraction: true,
            icon: '/favicons/signal.png',
          });
          activeNotifs.current.set(proposal.id, n);
          n.onclick = () => {
            window.focus();
            router.push(`/proposals/${proposal.id}`);
            n.close();
            activeNotifs.current.delete(proposal.id);
          };
          n.onclose = () => {
            activeNotifs.current.delete(proposal.id);
          };
        } catch (err) {
          console.warn('[notifications] Notification() failed', err);
        }
      }
    },
    [router, upsertProposal],
  );

  // ─── legacy signal:new (kept for Phase A↔B compat) ──────────────────────
  const handleSignal = useCallback(
    (signal: Signal) => {
      addSignal(signal);
      // No UI: the v1.3 proposal flow has taken over the modal path.
    },
    [addSignal],
  );

  // ─── position:updated (Phase F) ─────────────────────────────────────────
  const handlePositionUpdated = useCallback(
    (payload: PositionUpdatedPayload) => {
      if (payload.action === 'cancel-sibling' && payload.siblingKind) {
        // Push into the same demo store the demo simulator uses, so the
        // banner UX on Position Detail surfaces consistently in both modes.
        useDemoPositionsStore.setState((s) => ({
          cancelSiblingHints: {
            ...s.cancelSiblingHints,
            [payload.positionId]: {
              siblingKind: payload.siblingKind === 'TAKE_PROFIT' ? 'TP' : 'SL',
              createdAt: new Date().toISOString(),
            },
          },
        }));
        toast(`OCO: ${payload.siblingKind === 'TAKE_PROFIT' ? 'TP' : 'SL'} still parked in vault.`, {
          description: 'Open Position Detail to sign the withdrawal.',
          action: {
            label: 'Open',
            onClick: () => router.push(`/positions/${payload.positionId}`),
          },
        });
      } else if (payload.action === 'sibling-cancelled') {
        toast.success(`OCO sibling auto-cancelled.`);
      }
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
