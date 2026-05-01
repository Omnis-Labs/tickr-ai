'use client';

import { useState } from 'react';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useJupiterSwap, type SwapResult } from '@/lib/jupiter/use-jupiter-swap';
import { Section } from '../_components/section';
import { DEV_TOOLS_TOKEN } from '../_components/token';
import * as s from '../_components/styles';

const MIN_USD = 0.01;

export function UltraSwapSection({ onSwapped }: { onSwapped?: () => void }) {
  const { connected } = useWallet();
  const { swap, loading } = useJupiterSwap();
  const [usd, setUsd] = useState('1');
  const [result, setResult] = useState<SwapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usdNum = Number(usd);
  const valid = Number.isFinite(usdNum) && usdNum >= MIN_USD;

  async function handleSwap() {
    setError(null);
    setResult(null);
    try {
      const r = await swap({
        direction: 'BUY',
        xStockMint: DEV_TOOLS_TOKEN.mint,
        xStockDecimals: DEV_TOOLS_TOKEN.decimals,
        usdAmount: usdNum,
      });
      setResult(r);
      if (r.exec.status === 'Success') {
        onSwapped?.();
      } else {
        setError(`Swap failed: ${r.exec.error ?? 'unknown'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const buttonLabel = (() => {
    switch (loading) {
      case 'order':
        return 'Quoting…';
      case 'sign':
        return 'Awaiting signature…';
      case 'execute':
        return 'Submitting…';
      default:
        return `Sign & BUY ${DEV_TOOLS_TOKEN.symbol}`;
    }
  })();

  return (
    <Section
      id="s3"
      title={`Ultra Swap BUY · ${DEV_TOOLS_TOKEN.symbol}`}
      subtitle="Direct USDC → WEN via Jupiter Ultra. Gas sponsored. No DB write."
    >
      <div style={s.labelRow}>
        <label style={s.labelText} htmlFor="dev-swap-usd">
          USD Amount
        </label>
        <input
          id="dev-swap-usd"
          style={s.input}
          type="number"
          min={MIN_USD}
          step="0.01"
          value={usd}
          onChange={(e) => setUsd(e.target.value)}
        />
      </div>
      <button
        style={{ ...s.button, marginTop: 8 }}
        onClick={() => void handleSwap()}
        disabled={!connected || !valid || loading !== null}
      >
        {buttonLabel}
      </button>
      {error && <div style={s.errorText}>{error}</div>}
      {result && result.exec.status === 'Success' && (
        <div style={{ marginTop: 12 }}>
          <div style={s.okText}>Swap confirmed.</div>
          <pre style={{ ...s.pre, marginTop: 6 }}>
            {JSON.stringify(
              {
                signature: result.exec.signature,
                inAmount: result.inputAmount,
                outAmount: result.outputAmount,
                requestId: result.order.requestId,
              },
              null,
              2,
            )}
          </pre>
          {result.exec.signature && (
            <a
              href={`https://solscan.io/tx/${result.exec.signature}`}
              target="_blank"
              rel="noreferrer"
              style={{ ...s.muted, fontSize: 12 }}
            >
              Solscan ↗
            </a>
          )}
        </div>
      )}
    </Section>
  );
}
