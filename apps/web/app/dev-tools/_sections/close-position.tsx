'use client';

import { useCallback, useState } from 'react';
import { USDC_DECIMALS, USDC_MINT } from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useJupiterTrigger } from '@/lib/jupiter/use-jupiter-trigger';
import { useJupiterSwap, type SwapResult } from '@/lib/jupiter/use-jupiter-swap';
import { listOrderHistory } from '@/lib/jupiter/trigger';
import { Section } from '../_components/section';
import { DEV_TOOLS_TOKEN } from '../_components/token';
import * as s from '../_components/styles';

interface ClosePositionSectionProps {
  walletWenBalance: number | null;
  onClosed?: () => void;
}

interface CloseSummary {
  cancelled: number;
  swap: SwapResult | null;
  usdcOut: number | null;
}

/**
 * Mirror of the production close-position flow:
 *   1. Cancel every open WEN→USDC trigger order on this wallet (in case
 *      TP/SL is still pending; otherwise the deposit-craft would fail).
 *   2. Jupiter Ultra SELL all WEN → USDC.
 * Halts on first cancel failure to match S5's fail-fast contract.
 */
export function ClosePositionSection({
  walletWenBalance,
  onClosed,
}: ClosePositionSectionProps) {
  const { address, connected } = useWallet();
  const { cancel } = useJupiterTrigger();
  const { swap, loading: swapLoading } = useJupiterSwap();
  const [running, setRunning] = useState<'idle' | 'cancel' | 'swap'>('idle');
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const handleClose = useCallback(async () => {
    if (!address || !walletWenBalance || walletWenBalance <= 0) return;
    setError(null);
    setSummary(null);
    setProgress(null);

    setRunning('cancel');
    setProgress('Phase A: cancelling open WEN exit orders…');
    let cancelled = 0;
    try {
      const rows = await listOrderHistory({
        wallet: address,
        statuses: ['OPEN', 'PARTIALLY_FILLED'],
      });
      const exits = rows.filter(
        (o) => o.inputMint === DEV_TOOLS_TOKEN.mint && o.outputMint === USDC_MINT,
      );
      for (const o of exits) {
        await cancel(o.id);
        cancelled += 1;
      }
    } catch (err) {
      setError(
        `Phase A halt — cancel failed after ${cancelled} legs: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      setRunning('idle');
      return;
    }

    setRunning('swap');
    setProgress(`Phase A complete (${cancelled} cancelled). Phase B: SELL all ${DEV_TOOLS_TOKEN.symbol}…`);
    try {
      const r = await swap({
        direction: 'SELL',
        xStockMint: DEV_TOOLS_TOKEN.mint,
        xStockDecimals: DEV_TOOLS_TOKEN.decimals,
        sellAll: true,
      });
      const usdcOut = Number(r.outputAmount) / 10 ** USDC_DECIMALS;
      if (r.exec.status === 'Success') {
        setSummary({ cancelled, swap: r, usdcOut });
        setProgress(null);
        onClosed?.();
      } else {
        setError(`Phase B failed: ${r.exec.error ?? 'unknown'} (${cancelled} legs already cancelled)`);
      }
    } catch (err) {
      setError(
        `Phase B failed: ${err instanceof Error ? err.message : String(err)} (${cancelled} legs already cancelled)`,
      );
    } finally {
      setRunning('idle');
    }
  }, [address, walletWenBalance, cancel, swap, onClosed]);

  const validation = (() => {
    if (!connected) return 'Wallet not connected.';
    if (!walletWenBalance || walletWenBalance <= 0) return `No ${DEV_TOOLS_TOKEN.symbol} to close.`;
    return null;
  })();

  const buttonLabel = (() => {
    if (running === 'cancel') return 'Cancelling exits…';
    if (running === 'swap') return swapLoading ? `Selling… (${swapLoading})` : 'Selling…';
    return `Close (cancel exits → SELL all ${DEV_TOOLS_TOKEN.symbol})`;
  })();

  return (
    <Section
      id="s6"
      title="Close Position"
      subtitle="Mirror of production close: cancel TP/SL → SELL all WEN via Ultra."
    >
      {!walletWenBalance || walletWenBalance <= 0 ? (
        <div style={s.muted}>No {DEV_TOOLS_TOKEN.symbol} balance to close.</div>
      ) : (
        <>
          <div style={{ ...s.muted, marginBottom: 8 }}>
            Will cancel any open {DEV_TOOLS_TOKEN.symbol}→USDC trigger orders, then sell{' '}
            {walletWenBalance.toFixed(2)} {DEV_TOOLS_TOKEN.symbol} via Jupiter Ultra.
          </div>
          <button
            style={{ ...s.buttonDanger, marginTop: 4 }}
            onClick={() => void handleClose()}
            disabled={!!validation || running !== 'idle'}
          >
            {buttonLabel}
          </button>
          {validation && !error && <div style={s.errorText}>{validation}</div>}
          {error && <div style={s.errorText}>{error}</div>}
          {progress && <div style={s.muted}>{progress}</div>}
          {summary && (
            <div style={{ marginTop: 12 }}>
              <div style={s.okText}>
                Closed. Cancelled {summary.cancelled} exit
                {summary.cancelled === 1 ? '' : 's'}. Received{' '}
                {summary.usdcOut?.toFixed(4) ?? '—'} USDC.
              </div>
              {summary.swap?.exec.signature && (
                <a
                  href={`https://solscan.io/tx/${summary.swap.exec.signature}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...s.muted, fontSize: 12 }}
                >
                  Solscan ↗
                </a>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}
