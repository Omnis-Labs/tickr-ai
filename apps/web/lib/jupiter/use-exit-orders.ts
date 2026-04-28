'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useJupiterTrigger } from './use-jupiter-trigger';

/**
 * Single source of truth for the open-exit-order lifecycle attached to a
 * Position: cancel + place + replace, including the snapshot/rollback
 * race-window protection on Adjust.
 *
 * Three call sites previously each implemented some subset of this:
 *   - Position Detail: handleSubmitTpSl (cancel + re-place w/ rollback)
 *   - Position Detail: handleClose (cancel siblings then market sell)
 *   - SellProposalView: cancelOpenExitOrders (cancel only)
 *   - Settings panic close-all: cancel siblings then market sell, per pos
 *
 * Centralising the API + Jupiter calls + rollback here means future fixes
 * (extra retries, partial-fail telemetry, cancel-confirm awaits) land in
 * one place.
 */

export interface ExitLeg {
  kind: 'TAKE_PROFIT' | 'STOP_LOSS';
  triggerPriceUsd: number;
}

export interface PlaceExitArgs {
  inputMint: string;
  inputDecimals: number;
  tokenAmount: number;
  triggerPriceUsd: number;
  triggerCondition: 'above' | 'below';
}

export function useExitOrders() {
  const authedFetch = useAuthedFetch();
  const { placeSellExit, cancel: cancelTrigger } = useJupiterTrigger();

  /**
   * Cancel every open TP / SL trigger order attached to the given Position.
   * Returns a snapshot of the cancelled legs so the caller can roll back if
   * a follow-up step fails. Per-leg failures are surfaced via toast but
   * don't abort the loop.
   */
  const cancelExits = useCallback(
    async (positionId: string): Promise<ExitLeg[]> => {
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
      const open = (j.orders ?? []).filter(
        (o): o is typeof o & { jupiterOrderId: string } =>
          o.positionId === positionId &&
          (o.kind === 'TAKE_PROFIT' || o.kind === 'STOP_LOSS') &&
          !!o.jupiterOrderId,
      );
      const snapshot: ExitLeg[] = [];
      for (const o of open) {
        try {
          await cancelTrigger(o.jupiterOrderId);
          await authedFetch(`/api/orders/${o.id}/cancel`, { method: 'POST' }).catch(() => {});
          if (o.triggerPriceUsd != null) {
            snapshot.push({
              kind: o.kind as 'TAKE_PROFIT' | 'STOP_LOSS',
              triggerPriceUsd: o.triggerPriceUsd,
            });
          }
        } catch (err) {
          toast.error(
            `Cancel ${o.kind} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return snapshot;
    },
    [authedFetch, cancelTrigger],
  );

  /**
   * Place a single SELL trigger order leg. Thin wrapper to keep the hook
   * surface symmetric.
   */
  const placeExit = useCallback(
    async (args: PlaceExitArgs) => {
      return placeSellExit({
        inputMint: args.inputMint,
        inputDecimals: args.inputDecimals,
        tokenAmount: args.tokenAmount,
        triggerPriceUsd: args.triggerPriceUsd,
        triggerCondition: args.triggerCondition,
      });
    },
    [placeSellExit],
  );

  /**
   * Best-effort restore of a snapshot returned by cancelExits(). Called
   * when re-placement of new TP/SL legs partially fails mid-Adjust so the
   * Position isn't left exposed.
   */
  const rePlaceExits = useCallback(
    async (
      snapshot: ExitLeg[],
      meta: { mint: string; decimals: number },
      tokenAmount: number,
    ): Promise<void> => {
      for (const leg of snapshot) {
        try {
          await placeSellExit({
            inputMint: meta.mint,
            inputDecimals: meta.decimals,
            tokenAmount,
            triggerPriceUsd: leg.triggerPriceUsd,
            triggerCondition: leg.kind === 'TAKE_PROFIT' ? 'above' : 'below',
          });
        } catch (err) {
          toast.error(
            `Rollback ${leg.kind} @ $${leg.triggerPriceUsd.toFixed(2)} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },
    [placeSellExit],
  );

  /**
   * One-shot Adjust flow with rollback: cancel existing legs (capturing
   * the snapshot), place the new legs the caller wants, and on any
   * placement failure re-create the snapshot legs so the Position stays
   * protected. The new legs that did land remain — caller can dedupe on
   * the next Order Tracker tick.
   */
  const replaceExits = useCallback(
    async (
      positionId: string,
      meta: { mint: string; decimals: number },
      tokenAmount: number,
      newLegs: Array<{ kind: 'TAKE_PROFIT' | 'STOP_LOSS'; triggerPriceUsd: number | null }>,
    ): Promise<void> => {
      const snapshot = await cancelExits(positionId);
      try {
        for (const leg of newLegs) {
          if (leg.triggerPriceUsd == null) continue;
          await placeSellExit({
            inputMint: meta.mint,
            inputDecimals: meta.decimals,
            tokenAmount,
            triggerPriceUsd: leg.triggerPriceUsd,
            triggerCondition: leg.kind === 'TAKE_PROFIT' ? 'above' : 'below',
          });
        }
      } catch (err) {
        toast.error('Re-place failed; restoring previous TP/SL…');
        await rePlaceExits(snapshot, meta, tokenAmount);
        throw err;
      }
    },
    [cancelExits, placeSellExit, rePlaceExits],
  );

  return {
    cancelExits,
    placeExit,
    rePlaceExits,
    replaceExits,
  };
}
