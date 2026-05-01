'use client';

import { useCallback, useEffect, useState } from 'react';
import { USDC_MINT } from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useJupiterTrigger } from '@/lib/jupiter/use-jupiter-trigger';
import {
  listOrderHistory,
  type JupiterOrderHistoryEntry,
} from '@/lib/jupiter/trigger';
import { Section } from '../_components/section';
import { DEV_TOOLS_TOKEN } from '../_components/token';
import * as s from '../_components/styles';

interface ChangeTpSlSectionProps {
  walletWenBalance: number | null;
  onChanged?: () => void;
}

/**
 * One open SELL trigger order on the WEN→USDC pair. We do NOT infer TP vs
 * SL from a single survivor — that mistake (the highest is always TP) was
 * the source of an Oracle finding. We only label confidently when both
 * extremes are visible and use 'UNKNOWN_EXIT' for anything else.
 */
interface ExitLeg {
  id: string;
  triggerPriceUsd: number;
  kind: 'TAKE_PROFIT' | 'STOP_LOSS' | 'UNKNOWN_EXIT';
}

function isWenExit(o: JupiterOrderHistoryEntry): boolean {
  return o.inputMint === DEV_TOOLS_TOKEN.mint && o.outputMint === USDC_MINT;
}

/**
 * Returns ALL open WEN exits (cancel target for Phase A). Phase A must
 * cancel every one regardless of pair-display classification, otherwise
 * a wallet with three open exits would leave one stale leg behind.
 */
function allWenExits(rows: JupiterOrderHistoryEntry[]): JupiterOrderHistoryEntry[] {
  return rows.filter(isWenExit).filter((o) => typeof o.triggerPriceUsd === 'number');
}

/**
 * Display-only classification. Only labels TP/SL when exactly two legs
 * exist (highest = TP, lowest = SL). Anything else surfaces as
 * 'UNKNOWN_EXIT' so the user is reminded the labels are heuristic.
 */
function classifyForDisplay(open: JupiterOrderHistoryEntry[]): ExitLeg[] {
  if (open.length === 0) return [];
  if (open.length === 2) {
    const sorted = [...open].sort(
      (a, b) => (a.triggerPriceUsd ?? 0) - (b.triggerPriceUsd ?? 0),
    );
    const lowest = sorted[0]!;
    const highest = sorted[1]!;
    return [
      { id: highest.id, triggerPriceUsd: highest.triggerPriceUsd!, kind: 'TAKE_PROFIT' },
      { id: lowest.id, triggerPriceUsd: lowest.triggerPriceUsd!, kind: 'STOP_LOSS' },
    ];
  }
  return open.map((o) => ({
    id: o.id,
    triggerPriceUsd: o.triggerPriceUsd!,
    kind: 'UNKNOWN_EXIT' as const,
  }));
}

export function ChangeTpSlSection({ walletWenBalance, onChanged }: ChangeTpSlSectionProps) {
  const { address, connected } = useWallet();
  const { placeSellExit, cancel, loading } = useJupiterTrigger();
  const [allExits, setAllExits] = useState<JupiterOrderHistoryEntry[]>([]);
  const [legs, setLegs] = useState<ExitLeg[]>([]);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setRefreshing(true);
    try {
      const rows = await listOrderHistory({
        wallet: address,
        statuses: ['OPEN', 'PARTIALLY_FILLED'],
      });
      const open = allWenExits(rows);
      setAllExits(open);
      setLegs(classifyForDisplay(open));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    if (!connected) return;
    void refresh();
  }, [connected, refresh]);

  const tpNum = Number(tp);
  const slNum = Number(sl);
  const validation = (() => {
    if (!connected) return 'Wallet not connected.';
    if (allExits.length === 0)
      return 'No existing exits — use S4 to set initial TP/SL.';
    if (!walletWenBalance || walletWenBalance <= 0)
      return `No ${DEV_TOOLS_TOKEN.symbol} balance to re-protect.`;
    if (!Number.isFinite(tpNum) || tpNum <= 0) return 'Enter a positive new TP.';
    if (!Number.isFinite(slNum) || slNum <= 0) return 'Enter a positive new SL.';
    if (tpNum <= slNum) return 'TP must be greater than SL.';
    return null;
  })();

  async function handleReplace() {
    if (validation || !walletWenBalance) {
      setError(validation);
      return;
    }
    setError(null);
    setStatus(null);

    // Phase A: cancel EVERY open WEN exit (not just the displayed pair).
    // Halt on first failure so Phase B never runs against a partially-
    // cancelled set. This prevents stale-exit + new-exit pollution that
    // a 3-leg wallet would otherwise produce.
    const targets = allExits;
    setStatus(`Phase A: cancelling ${targets.length} existing leg${targets.length === 1 ? '' : 's'}…`);
    const cancelledIds: string[] = [];
    for (const leg of targets) {
      try {
        await cancel(leg.id);
        cancelledIds.push(leg.id);
      } catch (err) {
        setError(
          `Phase A halt — cancel of ${leg.id.slice(0, 8)}… @ $${leg.triggerPriceUsd?.toFixed(6)} failed: ${
            err instanceof Error ? err.message : String(err)
          }. Cancelled so far: ${cancelledIds.length} of ${targets.length}.`,
        );
        void refresh();
        return;
      }
    }
    setStatus(`Phase A complete (${cancelledIds.length} cancelled). Phase B: placing new legs…`);

    // Phase B: place new TP, then new SL. Failures here are surfaced
    // precisely so the user can recover (rePlace via S5 again).
    try {
      await placeSellExit({
        inputMint: DEV_TOOLS_TOKEN.mint,
        inputDecimals: DEV_TOOLS_TOKEN.decimals,
        tokenAmount: walletWenBalance,
        triggerPriceUsd: tpNum,
        triggerCondition: 'above',
      });
      await placeSellExit({
        inputMint: DEV_TOOLS_TOKEN.mint,
        inputDecimals: DEV_TOOLS_TOKEN.decimals,
        tokenAmount: walletWenBalance,
        triggerPriceUsd: slNum,
        triggerCondition: 'below',
      });
      setStatus(`Replaced. New TP @ $${tpNum}, new SL @ $${slNum}.`);
      onChanged?.();
    } catch (err) {
      setError(
        `Phase B partial — ${err instanceof Error ? err.message : String(err)}. Old legs already cancelled. Refresh and use S4 to set the missing leg(s).`,
      );
    } finally {
      void refresh();
    }
  }

  if (allExits.length === 0) {
    return (
      <Section
        id="s5"
        title="Change TP/SL"
        subtitle="Hidden — no existing exits. Use S4 to set initial."
      >
        <div style={s.muted}>
          No open exit orders for {DEV_TOOLS_TOKEN.symbol}.{' '}
          <button
            style={{ ...s.buttonGhost, fontSize: 11, padding: '4px 8px' }}
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </Section>
    );
  }

  const ambiguousLabels = legs.some((l) => l.kind === 'UNKNOWN_EXIT');

  return (
    <Section
      id="s5"
      title="Change TP/SL"
      subtitle={`${allExits.length} existing exit${allExits.length === 1 ? '' : 's'}. Phase-A cancel-all → Phase-B place-new (fail-fast).`}
      trailing={
        <button style={s.buttonGhost} onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      <div style={{ ...s.muted, marginBottom: 8 }}>
        Current exits (Phase A will cancel all {allExits.length}; Phase B places one new
        TP and one new SL using {walletWenBalance?.toFixed(2) ?? '?'}{' '}
        {DEV_TOOLS_TOKEN.symbol}):
      </div>
      {ambiguousLabels && (
        <div style={{ ...s.errorText, marginBottom: 6, fontSize: 11 }}>
          ⚠ Heuristic labels disabled — exit count ≠ 2. Showing raw legs.
        </div>
      )}
      {legs.map((leg) => {
        const color =
          leg.kind === 'TAKE_PROFIT'
            ? '#22c55e'
            : leg.kind === 'STOP_LOSS'
              ? '#ef4444'
              : '#888';
        const label =
          leg.kind === 'TAKE_PROFIT'
            ? 'TP'
            : leg.kind === 'STOP_LOSS'
              ? 'SL'
              : 'EXIT';
        return (
          <div key={leg.id} style={{ ...s.flexRow, marginBottom: 4 }}>
            <span style={{ ...s.badge(color), minWidth: 80, textAlign: 'center' }}>
              {label}
            </span>
            <span style={{ fontSize: 13 }}>${leg.triggerPriceUsd.toFixed(6)}</span>
            <span style={{ ...s.muted, fontSize: 11 }}>{leg.id.slice(0, 8)}…</span>
          </div>
        );
      })}

      <div style={{ ...s.grid2, marginTop: 12 }}>
        <div style={s.labelRow}>
          <label style={s.labelText} htmlFor="dev-tp-new">
            New TP (USD)
          </label>
          <input
            id="dev-tp-new"
            style={s.input}
            type="number"
            min="0"
            step="0.000001"
            value={tp}
            onChange={(e) => setTp(e.target.value)}
          />
        </div>
        <div style={s.labelRow}>
          <label style={s.labelText} htmlFor="dev-sl-new">
            New SL (USD)
          </label>
          <input
            id="dev-sl-new"
            style={s.input}
            type="number"
            min="0"
            step="0.000001"
            value={sl}
            onChange={(e) => setSl(e.target.value)}
          />
        </div>
      </div>

      <button
        style={{ ...s.button, marginTop: 12 }}
        onClick={() => void handleReplace()}
        disabled={!!validation || !!loading}
      >
        {loading ? `Working… (${loading})` : 'Cancel all → Place new'}
      </button>
      {validation && !error && <div style={s.errorText}>{validation}</div>}
      {error && <div style={s.errorText}>{error}</div>}
      {status && <div style={s.muted}>{status}</div>}
    </Section>
  );
}
