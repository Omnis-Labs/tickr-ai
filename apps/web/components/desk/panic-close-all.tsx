'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { useRuntime } from '@/lib/runtime/use-runtime';
import { QK } from '@/lib/hooks/queries';

export interface ClosablePosition {
  id: string;
  /** assetId — e.g. "GOOGLx" */
  ticker: string;
  tokenAmount: number;
  entryPrice: number;
  state: string;
}

interface Props {
  positions: ClosablePosition[];
}

/**
 * Panic-close-all button on /desk. Iterates ACTIVE positions, calling
 * runtime.closePosition with the position's tokenAmount so the swap
 * sells exactly the position size — not the wallet's full balance for
 * that mint, which would sweep dust or sibling holdings.
 *
 * Sequential, not parallel: Privy's signAndSendTransaction broadcasts
 * via a shared RPC, and parallel fires would race the same blockhash
 * window + thrash the wallet's tx queue. One position at a time keeps
 * each fill cleanly attributable in the DB.
 *
 * BUY_PENDING / ENTERING positions are not closed here — they have no
 * tokens to sell. Filter happens at the caller; we only render when
 * there's at least one ACTIVE row.
 *
 * Two-step UX matching the per-position CloseButton (button → confirm).
 */
export function PanicCloseAll({ positions }: Props) {
  const runtime = useRuntime();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const closable = positions.filter((p) => p.state === 'ACTIVE' && p.tokenAmount > 0);
  if (closable.length === 0) return null;

  async function handleAll() {
    setBusy(true);
    const toastId = `panic-close-${Date.now()}`;
    let ok = 0;
    const failures: string[] = [];

    toast.loading(`Closing 0 / ${closable.length}…`, { id: toastId, duration: Infinity });

    for (let i = 0; i < closable.length; i++) {
      const p = closable[i]!;
      const meta = XSTOCKS[xStockToBare(p.ticker as XStockTicker)];
      if (!meta?.mint) {
        failures.push(`${p.ticker} (mint missing)`);
        continue;
      }
      try {
        await runtime.closePosition({
          positionId: p.id,
          meta: { mint: meta.mint, decimals: meta.decimals },
          fallbackMarkPrice: p.entryPrice,
          tokenAmount: p.tokenAmount,
        });
        ok++;
      } catch (err) {
        failures.push(`${p.ticker} (${err instanceof Error ? err.message : 'failed'})`);
      }
      toast.loading(`Closing ${i + 1} / ${closable.length}…`, {
        id: toastId,
        duration: Infinity,
      });
    }

    if (failures.length === 0) {
      toast.success(`Closed all ${ok} position${ok === 1 ? '' : 's'}.`, {
        id: toastId,
        duration: 8_000,
      });
    } else {
      toast.error(
        `Closed ${ok} / ${closable.length}. Failed: ${failures.join(', ')}`,
        { id: toastId, duration: 14_000 },
      );
    }

    void qc.invalidateQueries({ queryKey: QK.positions() });
    void qc.invalidateQueries({ queryKey: QK.orders() });
    void qc.invalidateQueries({ queryKey: QK.portfolio() });
    setBusy(false);
    setConfirm(false);
  }

  if (!confirm) {
    return (
      <section className="mb-6">
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="w-full rounded-full border border-negative/40 bg-negative/10 px-5 py-3 text-label-md font-semibold text-negative transition-transform active:scale-[0.97]"
        >
          Panic close all ({closable.length})
        </button>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <div className="rounded-lg border border-negative/40 bg-negative/10 p-4">
        <p className="mb-3 text-body-sm text-on-surface">
          Cancel exits and market-sell <strong>{closable.length}</strong> active{' '}
          {closable.length === 1 ? 'position' : 'positions'} via Jupiter Ultra. Each closes
          sequentially; you'll sign one tx per position.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setConfirm(false)}
            disabled={busy}
            className="flex-1 h-11 rounded-full border border-outline text-label-md text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleAll()}
            disabled={busy}
            className="flex-[2] h-11 rounded-full bg-negative text-on-negative text-label-lg font-semibold disabled:opacity-60"
          >
            {busy ? 'Closing…' : `Confirm close ${closable.length}`}
          </button>
        </div>
      </div>
    </section>
  );
}
