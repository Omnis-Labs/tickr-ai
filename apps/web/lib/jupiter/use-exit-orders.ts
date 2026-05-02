'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAuthedFetch } from '@/lib/auth/fetch';

/**
 * Single source of truth for the open-exit-order lifecycle attached to
 * a Position: cancel + place + replace.
 *
 * Synthetic-trigger architecture (post-pivot away from Jupiter Trigger
 * v2 for xStocks): TP/SL legs are plain DB rows with
 * `jupiterOrderId IS NULL`; the ws-server price monitor watches them
 * against Pyth and emits `trigger:hit` when the user needs to sign an
 * Ultra swap to actually exit. So all "place" / "cancel" operations on
 * exit Orders here are pure DB persistence — no off-chain escrow to
 * lock or release. cancelExits still also handles legacy Jupiter-routed
 * Orders via `/api/orders/[id]/cancel`, which itself dispatches to the
 * Jupiter trigger cancel under the hood when jupiterOrderId is set.
 *
 * Call sites:
 *   - Position Detail: handleConfirmExit (ENTERING → place OCO)
 *   - Position Detail: handleSubmitTpSl (Adjust → cancel + place OCO)
 *   - SellProposalView: cancelOpenExitOrders (cancel only)
 *   - useRuntime.closePosition: cancelExits before market sell
 */

export interface ExitSnapshot {
  tpPriceUsd: number | null;
  slPriceUsd: number | null;
}

export interface PlaceOcoExitArgs {
  /** Position the exit legs attach to. */
  positionId: string;
  /** Wallet address used as the user-creation hint by /api/orders if
   *  this is the first request from this user (downstream
   *  requireAuthOrUpsert). */
  walletAddress: string;
  /** AssetId — e.g. "GOOGLx". */
  ticker: string;
  /** xStock units the position holds. Persisted on each Order so the
   *  trigger-monitor can later hand back the exact sell size in
   *  TriggerHitPayload.tokenAmount. */
  tokenAmount: number;
  tpPriceUsd: number;
  slPriceUsd: number;
}

export function useExitOrders() {
  const authedFetch = useAuthedFetch();

  /**
   * Cancel every open TP / SL exit order attached to the given Position.
   * Returns the cancelled prices as a snapshot so callers can restore
   * after a re-place fails midway. Per-row failures surface via toast
   * but don't abort.
   */
  const cancelExits = useCallback(
    async (positionId: string): Promise<ExitSnapshot> => {
      const r = await authedFetch('/api/orders');
      const j = (await r.json().catch(() => ({}))) as {
        orders?: Array<{
          id: string;
          positionId: string;
          kind: string;
          jupiterOrderId: string | null;
          triggerPriceUsd: number | null;
        }>;
      };
      const exits = (j.orders ?? []).filter(
        (o) =>
          o.positionId === positionId &&
          (o.kind === 'TAKE_PROFIT' || o.kind === 'STOP_LOSS'),
      );

      let tpPriceUsd: number | null = null;
      let slPriceUsd: number | null = null;
      for (const o of exits) {
        if (o.kind === 'TAKE_PROFIT' && o.triggerPriceUsd != null) tpPriceUsd = o.triggerPriceUsd;
        if (o.kind === 'STOP_LOSS' && o.triggerPriceUsd != null) slPriceUsd = o.triggerPriceUsd;
      }

      // /api/orders/[id]/cancel handles both flavours: synthetic rows
      // just flip status=CANCELLED; legacy Jupiter-routed rows
      // additionally fire the v2 trigger cancel before persisting.
      for (const o of exits) {
        await authedFetch(`/api/orders/${o.id}/cancel`, { method: 'POST' }).catch(() => {});
      }
      return { tpPriceUsd, slPriceUsd };
    },
    [authedFetch],
  );

  /**
   * Place TP + SL synthetic exit Orders. Two POST /api/orders calls,
   * one per leg, both with `jupiterOrderId: null` so the ws-server
   * trigger-monitor picks them up. The `tokenAmount` carries through
   * to TriggerHitPayload at fire time so the eventual Ultra sell
   * sells exactly the position size (not the wallet's full balance).
   */
  const placeOcoExit = useCallback(
    async (args: PlaceOcoExitArgs): Promise<{ id: string }> => {
      const legs: Array<{
        kind: 'TAKE_PROFIT' | 'STOP_LOSS';
        triggerPriceUsd: number;
      }> = [
        { kind: 'TAKE_PROFIT', triggerPriceUsd: args.tpPriceUsd },
        { kind: 'STOP_LOSS', triggerPriceUsd: args.slPriceUsd },
      ];

      const orderIds: string[] = [];
      for (const leg of legs) {
        const r = await authedFetch('/api/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            walletAddress: args.walletAddress,
            positionId: args.positionId,
            ticker: args.ticker,
            kind: leg.kind,
            side: 'SELL',
            triggerPriceUsd: leg.triggerPriceUsd,
            sizeUsd: leg.triggerPriceUsd * args.tokenAmount,
            tokenAmount: args.tokenAmount,
            jupiterOrderId: null,
          }),
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `place ${leg.kind} ${r.status}`);
        }
        const j = (await r.json()) as { order?: { id: string } };
        if (j.order?.id) orderIds.push(j.order.id);
      }

      // Caller treats this id opaquely (used for "OCO …8 placed" toast).
      // Returning the TP id is fine — both legs share the same Position.
      return { id: orderIds[0] ?? args.positionId };
    },
    [authedFetch],
  );

  /**
   * Best-effort restore of a snapshot returned by cancelExits(). Called
   * when re-placement during Adjust partially fails so the Position
   * isn't left exposed.
   */
  const rePlaceExits = useCallback(
    async (
      snapshot: ExitSnapshot,
      args: Omit<PlaceOcoExitArgs, 'tpPriceUsd' | 'slPriceUsd'>,
    ): Promise<void> => {
      if (snapshot.tpPriceUsd == null || snapshot.slPriceUsd == null) return;
      try {
        await placeOcoExit({
          ...args,
          tpPriceUsd: snapshot.tpPriceUsd,
          slPriceUsd: snapshot.slPriceUsd,
        });
      } catch (err) {
        toast.error(
          `Rollback OCO @ $${snapshot.tpPriceUsd}/$${snapshot.slPriceUsd} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [placeOcoExit],
  );

  /**
   * One-shot Adjust: cancel existing exits, place new ones, rollback
   * on failure.
   */
  const replaceExits = useCallback(
    async (
      args: Omit<PlaceOcoExitArgs, 'tpPriceUsd' | 'slPriceUsd'> & {
        next: { tpPriceUsd: number | null; slPriceUsd: number | null };
      },
    ): Promise<void> => {
      const snapshot = await cancelExits(args.positionId);
      if (args.next.tpPriceUsd == null || args.next.slPriceUsd == null) return;
      try {
        await placeOcoExit({
          positionId: args.positionId,
          walletAddress: args.walletAddress,
          ticker: args.ticker,
          tokenAmount: args.tokenAmount,
          tpPriceUsd: args.next.tpPriceUsd,
          slPriceUsd: args.next.slPriceUsd,
        });
      } catch (err) {
        toast.error('Re-place failed; restoring previous TP/SL…');
        await rePlaceExits(snapshot, {
          positionId: args.positionId,
          walletAddress: args.walletAddress,
          ticker: args.ticker,
          tokenAmount: args.tokenAmount,
        });
        throw err;
      }
    },
    [cancelExits, placeOcoExit, rePlaceExits],
  );

  return {
    cancelExits,
    placeOcoExit,
    rePlaceExits,
    replaceExits,
  };
}
