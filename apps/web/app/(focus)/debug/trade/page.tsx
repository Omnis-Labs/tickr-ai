'use client';

import { useState } from 'react';
import { useWallet } from '@/lib/wallet/use-wallet';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  BARE_TICKERS,
  USDC_DECIMALS,
  XSTOCKS,
  solscanTokenUrl,
  type BareTicker,
} from '@hunch-it/shared';
import { useJupiterSwap, type SwapResult } from '@/lib/jupiter/use-jupiter-swap';
import { WalletButton } from '@/components/wallet/wallet-button';

export default function DebugTradePage() {
  const { publicKey, connected } = useWallet();
  const { swap, loading } = useJupiterSwap();
  const [ticker, setTicker] = useState<BareTicker>('AAPL');
  const [usdAmount, setUsdAmount] = useState('5');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [result, setResult] = useState<SwapResult | null>(null);

  const meta = XSTOCKS[ticker];
  const mint = meta.mint;
  const mintReady = mint.length > 0;

  async function handleSwap() {
    if (!publicKey) return;
    if (!mintReady) {
      toast.error(
        `${meta.symbol} mint not yet verified — run \`pnpm --filter @hunch-it/ws-server verify:xstocks\`.`,
      );
      return;
    }
    const usd = Number(usdAmount);
    if (direction === 'BUY' && (!Number.isFinite(usd) || usd <= 0)) {
      toast.error('Enter a positive USD amount');
      return;
    }
    setResult(null);
    try {
      const r =
        direction === 'BUY'
          ? await swap({
              direction: 'BUY',
              xStockMint: mint,
              xStockDecimals: meta.decimals,
              usdAmount: usd,
            })
          : await swap({
              direction: 'SELL',
              xStockMint: mint,
              xStockDecimals: meta.decimals,
              sellAll: true,
            });
      setResult(r);
      if (r.exec.status === 'Success') {
        toast.success(`Swap confirmed: ${r.exec.signature ?? '(no sig)'}`);
        // Persist trade. Side === direction; estimate execution price from in/out.
        const tokenAmount =
          direction === 'BUY'
            ? Number(r.outputAmount) / 10 ** meta.decimals
            : Number(r.inputAmount) / 10 ** meta.decimals;
        const usdValue =
          direction === 'BUY'
            ? Number(r.inputAmount) / 10 ** USDC_DECIMALS
            : Number(r.outputAmount) / 10 ** USDC_DECIMALS;
        const executionPrice = tokenAmount > 0 ? usdValue / tokenAmount : 0;
        await fetch('/api/trades', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            walletAddress: publicKey.toBase58(),
            signalId: null,
            ticker: meta.symbol,
            side: direction,
            amountUsd: usdValue,
            tokenAmount,
            executionPrice,
            txSignature: r.exec.signature ?? `unknown-${Date.now()}`,
            status: 'CONFIRMED',
          }),
        }).catch((err) => console.warn('[trade] persist failed', err));
      } else {
        toast.error(`Swap failed: ${r.exec.error ?? 'unknown'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>
      <h1 style={{ fontSize: 32, fontWeight: 800, margin: '16px 0 8px' }}>/debug/trade</h1>
      <p style={{ color: 'var(--color-fg-muted)', marginBottom: 24 }}>
        Manual end-to-end Jupiter Ultra swap. Gas is sponsored. Trades persist via{' '}
        <code>/api/trades</code>.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>Wallet</div>
            <div style={{ fontSize: 14 }}>
              {connected && publicKey ? publicKey.toBase58() : 'not connected'}
            </div>
          </div>
          <WalletButton />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>Direction</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'BUY' | 'SELL')}
              style={inputStyle}
            >
              <option value="BUY">BUY (USDC → xStock)</option>
              <option value="SELL">SELL (xStock → USDC, all)</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>Ticker</span>
            <select
              value={ticker}
              onChange={(e) => setTicker(e.target.value as BareTicker)}
              style={inputStyle}
            >
              {BARE_TICKERS.map((t) => {
                const m = XSTOCKS[t];
                return (
                  <option key={t} value={t}>
                    {m.symbol} {m.mint ? '✓' : '⚠'}
                  </option>
                );
              })}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
              {direction === 'BUY' ? 'USDC' : '(SELL ALL)'}
            </span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={usdAmount}
              disabled={direction === 'SELL'}
              onChange={(e) => setUsdAmount(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
        {mintReady ? (
          <div style={{ fontSize: 12, color: 'var(--color-buy)', marginBottom: 12 }}>
            ✓ Verified mint{' '}
            <a
              href={solscanTokenUrl(mint)}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--color-accent)' }}
            >
              {mint.slice(0, 6)}…{mint.slice(-4)}
            </a>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-warn)', marginBottom: 12 }}>
            ⚠ {meta.symbol} mint is empty. Run{' '}
            <code>pnpm --filter @hunch-it/ws-server verify:xstocks</code>.
          </div>
        )}
        <button
          className={direction === 'SELL' ? 'btn btn-sell' : 'btn btn-buy'}
          disabled={!connected || loading !== null}
          onClick={handleSwap}
          style={{ padding: '14px 24px', fontSize: 15 }}
        >
          {loading === 'order'
            ? 'Fetching quote…'
            : loading === 'sign'
              ? 'Awaiting signature…'
              : loading === 'execute'
                ? 'Submitting…'
                : `Sign & ${direction} ${meta.symbol}`}
        </button>
      </div>

      {result && (
        <div className="card">
          <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', marginBottom: 6 }}>Result</div>
          <pre
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: 'var(--color-fg-muted)',
            }}
          >
            {JSON.stringify(
              {
                status: result.exec.status,
                signature: result.exec.signature,
                inAmount: result.inputAmount,
                outAmount: result.outputAmount,
                requestId: result.order.requestId,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  background: 'var(--color-bg-muted)',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
};
