'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useJupiterTrigger } from './use-jupiter-trigger';

/**
 * Single source of truth for the open-exit-order lifecycle attached to
 * a Position: cancel + place + replace.
 *
 * v2 API surface change: TP/SL are now placed as a single OCO order
 * (`orderType: 'OCO'`) instead of two separate single orders. Jupiter
 * handles sibling-cancel server-side. Our DB still keeps two Order
 * rows per OCO (TAKE_PROFIT + STOP_LOSS sharing the same
 * jupiterOrderId) so the rest of the app — UI, history, audit — keeps
 * working unchanged.
 *
 * Call sites using this hook today:
 *   - Position Detail: handleConfirmExit (ENTERING → place OCO)
 *   - Position Detail: handleSubmitTpSl (Adjust → cancel + place OCO)
 *   - SellProposalView: cancelOpenExitOrders (cancel only)
 *   - Settings panic close-all: cancel siblings then market sell
 */

export interface ExitSnapshot {
  tpPriceUsd: number | null;
  slPriceUsd: number | null;
}

export interface PlaceOcoExitArgs {
  inputMint: string;
  inputDecimals: number;
  tokenAmount: number;
  tpPriceUsd: number;
  slPriceUsd: number;
  /** Per-leg slippage. Defaults to 75 bps each. */
  tpSlippageBps?: number;
  slSlippageBps?: number;
}

export function useExitOrders() {
  const authedFetch = useAuthedFetch();
  const { placeSellExit, cancel: cancelTrigger } = useJupiterTrigger();

  /**
   * Cancel every open TP / SL trigger order attached to the given Position.
   * Returns a single snapshot summarising the existing TP+SL prices so
   * the caller can roll back if a follow-up step fails. Per-leg
   * failures surface via toast but don't abort.
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
      const open = (j.orders ?? []).filter(
        (o): o is typeof o & { jupiterOrderId: string } =>
          o.positionId === positionId &&
          (o.kind === 'TAKE_PROFIT' || o.kind === 'STOP_LOSS') &&
          !!o.jupiterOrderId,
      );

      // OCO: TP and SL share one jupiterOrderId. We cancel the Jupiter
      // order once per unique id, then mark both DB rows cancelled.
      const uniqueJupiterIds = Array.from(new Set(open.map((o) => o.jupiterOrderId)));
      let tpPriceUsd: number | null = null;
      let slPriceUsd: number | null = null;
      for (const o of open) {
        if (o.kind === 'TAKE_PROFIT' && o.triggerPriceUsd != null) tpPriceUsd = o.triggerPriceUsd;
        if (o.kind === 'STOP_LOSS' && o.triggerPriceUsd != null) slPriceUsd = o.triggerPriceUsd;
      }
      for (const jid of uniqueJupiterIds) {
        try {
          await cancelTrigger(jid);
        } catch (err) {
          toast.error(
            `Cancel order ${jid.slice(0, 8)}… failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Then mark every linked DB Order row CANCELLED.
      for (const o of open) {
        await authedFetch(`/api/orders/${o.id}/cancel`, { method: 'POST' }).catch(() => {});
      }
      return { tpPriceUsd, slPriceUsd };
    },
    [authedFetch, cancelTrigger],
  );

  /**
   * Place a TP+SL OCO order against an existing position. The wallet
   * signs once and Jupiter manages the sibling-cancel race natively.
   */
  const placeOcoExit = useCallback(
    async (args: PlaceOcoExitArgs) => {
      return placeSellExit({
        inputMint: args.inputMint,
        inputDecimals: args.inputDecimals,
        tokenAmount: args.tokenAmount,
        tpPriceUsd: args.tpPriceUsd,
        slPriceUsd: args.slPriceUsd,
        tpSlippageBps: args.tpSlippageBps,
        slSlippageBps: args.slSlippageBps,
      });
    },
    [placeSellExit],
  );

  /**
   * Best-effort restore of a snapshot returned by cancelExits(). Called
   * when re-placement during Adjust partially fails so the Position
   * isn't left exposed. Re-places as a fresh OCO with whatever prices
   * the snapshot captured.
   */
  const rePlaceExits = useCallback(
    async (
      snapshot: ExitSnapshot,
      meta: { mint: string; decimals: number },
      tokenAmount: number,
    ): Promise<void> => {
      if (snapshot.tpPriceUsd == null || snapshot.slPriceUsd == null) return;
      try {
        await placeSellExit({
          inputMint: meta.mint,
          inputDecimals: meta.decimals,
          tokenAmount,
          tpPriceUsd: snapshot.tpPriceUsd,
          slPriceUsd: snapshot.slPriceUsd,
        });
      } catch (err) {
        toast.error(
          `Rollback OCO @ $${snapshot.tpPriceUsd}/$${snapshot.slPriceUsd} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [placeSellExit],
  );

  /**
   * One-shot Adjust: cancel existing OCO, place new OCO, rollback on
   * failure. The new OCO replaces the old in a single tx pair on
   * Jupiter's side; if the cancel succeeds but the new place fails, we
   * try to restore the snapshot.
   */
  const replaceExits = useCallback(
    async (
      positionId: string,
      meta: { mint: string; decimals: number },
      tokenAmount: number,
      newLegs: { tpPriceUsd: number | null; slPriceUsd: number | null },
    ): Promise<void> => {
      const snapshot = await cancelExits(positionId);
      if (newLegs.tpPriceUsd == null || newLegs.slPriceUsd == null) return;
      try {
        await placeSellExit({
          inputMint: meta.mint,
          inputDecimals: meta.decimals,
          tokenAmount,
          tpPriceUsd: newLegs.tpPriceUsd,
          slPriceUsd: newLegs.slPriceUsd,
        });
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
    placeOcoExit,
    rePlaceExits,
    replaceExits,
  };
}
