'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@/lib/wallet/use-wallet';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  DEMO_FAKE_MINT,
  USDC_DECIMALS,
  XSTOCKS,
  xStockToBare,
  type Signal,
  type XStockTicker,
} from '@hunch-it/shared';
import { useSharedWorker } from '@/lib/shared-worker/use-shared-worker';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { isDemo, useDemoStore } from '@/lib/demo';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';

const DEFAULT_TRADE_USD = Number(process.env.NEXT_PUBLIC_DEFAULT_TRADE_USD ?? '5');

interface SignalModalProps {
  signal: Signal | null;
  fallbackId?: string;
  onClose: (decision: boolean | null) => void;
}

function ttlColor(ratio: number): string {
  if (ratio > 0.5) return 'var(--color-buy)';
  if (ratio > 0.2) return 'var(--color-warn)';
  return 'var(--color-sell)';
}

export function SignalModal({ signal, fallbackId, onClose }: SignalModalProps) {
  const { publicKey } = useWallet();
  const { sendApproval } = useSharedWorker();
  const { swap, loading: swapLoading } = useJupiterSwap();
  const [now, setNow] = useState(() => Date.now());
  const [executing, setExecuting] = useState(false);
  const [bars, setBars] = useState<ChartBar[]>([]);

  useEffect(() => {
    if (!signal) return;
    let cancelled = false;
    const bare = xStockToBare(signal.ticker as XStockTicker);
    fetch(`/api/bars/${bare}?resolution=5&hours=24`)
      .then((r) => (r.ok ? (r.json() as Promise<{ bars: ChartBar[] }>) : null))
      .then((j) => {
        if (!cancelled && j?.bars) setBars(j.bars);
      })
      .catch(() => {
        /* ignore — chart just won't render */
      });
    return () => {
      cancelled = true;
    };
  }, [signal?.id, signal?.ticker]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const { secondsLeft, ratio } = useMemo(() => {
    if (!signal) return { secondsLeft: 0, ratio: 0 };
    const total = signal.ttlSeconds * 1000;
    const remain = new Date(signal.expiresAt).getTime() - now;
    const r = Math.max(0, Math.min(1, remain / total));
    return { secondsLeft: Math.max(0, Math.ceil(remain / 1000)), ratio: r };
  }, [signal, now]);

  useEffect(() => {
    if (!signal) return;
    if (secondsLeft <= 0 && !executing) {
      void submit(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, signal?.id, executing]);

  async function submit(decision: boolean) {
    if (!signal) {
      onClose(null);
      return;
    }

    const demo = isDemo();
    const walletKey = publicKey?.toBase58() ?? (demo ? 'demo-wallet' : null);
    if (!walletKey) {
      toast.error('Connect a wallet to approve signals');
      return;
    }

    // Always record the approval decision first (Yes or No) unless demo.
    if (!demo) {
      sendApproval({
        signalId: signal.id,
        walletAddress: walletKey,
        decision,
      });
      void fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          signalId: signal.id,
          walletAddress: walletKey,
          decision,
        }),
      }).catch(() => {});
    }

    if (!decision) {
      toast('Signal skipped');
      onClose(decision);
      return;
    }

    if (signal.action === 'HOLD') {
      toast('HOLD signal — no trade executed.');
      onClose(decision);
      return;
    }
    const action: 'BUY' | 'SELL' = signal.action;

    // Yes path: pull mint, run Jupiter Ultra round-trip, persist trade.
    const bare = xStockToBare(signal.ticker as XStockTicker);
    const meta = XSTOCKS[bare];
    if (!meta) {
      toast.error(`Unknown ticker ${signal.ticker}`);
      onClose(decision);
      return;
    }
    const mintForSwap = meta.mint || (demo ? DEMO_FAKE_MINT : '');
    if (!mintForSwap) {
      toast.error(
        `${meta.symbol} mint is empty — run \`pnpm --filter @hunch-it/ws-server verify:xstocks\`.`,
      );
      onClose(decision);
      return;
    }

    setExecuting(true);
    try {
      const result =
        action === 'BUY'
          ? await swap({
              direction: 'BUY',
              xStockMint: mintForSwap,
              xStockDecimals: meta.decimals,
              usdAmount: DEFAULT_TRADE_USD,
            })
          : await swap({
              direction: 'SELL',
              xStockMint: mintForSwap,
              xStockDecimals: meta.decimals,
              sellAll: true,
            });

      const tokenAmount =
        action === 'BUY'
          ? Number(result.outputAmount) / 10 ** meta.decimals
          : Number(result.inputAmount) / 10 ** meta.decimals;
      const usdValue =
        action === 'BUY'
          ? Number(result.inputAmount) / 10 ** USDC_DECIMALS
          : Number(result.outputAmount) / 10 ** USDC_DECIMALS;
      const executionPrice = tokenAmount > 0 ? usdValue / tokenAmount : signal.priceAtSignal;

      if (demo) {
        // Track the trade in the in-memory demo store — portfolio + P&L pick it up.
        useDemoStore.getState().appendTrade({
          signalId: signal.id,
          ticker: signal.ticker,
          side: action,
          amountUsd: usdValue,
          tokenAmount,
          executionPrice,
          realizedPnl: 0,
          txSignature: result.exec.signature ?? `demo-${Date.now()}`,
          status: result.exec.status === 'Success' ? 'CONFIRMED' : 'FAILED',
        });
      } else {
        await fetch('/api/trades', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            walletAddress: walletKey,
            signalId: signal.id,
            ticker: signal.ticker,
            side: action,
            amountUsd: usdValue,
            tokenAmount,
            executionPrice,
            txSignature: result.exec.signature ?? `unknown-${Date.now()}`,
            status: result.exec.status === 'Success' ? 'CONFIRMED' : 'FAILED',
          }),
        });
      }

      if (result.exec.status === 'Success') {
        toast.success(`${signal.action} ${signal.ticker} confirmed${demo ? ' (demo)' : ''}`);
      } else {
        toast.error(`Swap failed: ${result.exec.error ?? 'unknown'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
      onClose(decision);
    }
  }

  if (!signal) {
    return (
      <motion.div
        style={overlayStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className="card"
          style={{ maxWidth: 420 }}
          initial={{ scale: 0.94, y: 12, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Signal not found</h2>
          <p style={{ color: 'var(--color-fg-muted)', marginBottom: 16 }}>
            {fallbackId ? (
              <>
                This signal has expired or wasn't received by this tab:{' '}
                <code style={{ fontSize: 12 }}>{fallbackId}</code>.
              </>
            ) : (
              <>No signal id provided.</>
            )}
          </p>
          <button className="btn btn-ghost" onClick={() => onClose(null)}>
            Close
          </button>
        </motion.div>
      </motion.div>
    );
  }

  const actionClass =
    signal.action === 'BUY' ? 'badge-buy' : signal.action === 'SELL' ? 'badge-sell' : 'badge-hold';
  // lightweight-charts can't parse CSS variables — pass concrete hex.
  const markerColor =
    signal.action === 'BUY' ? '#22c55e' : signal.action === 'SELL' ? '#ef4444' : '#9099ad';

  return (
    <motion.div
      style={overlayStyle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="card"
        style={{
          width: 'min(640px, 92vw)',
          padding: '32px 32px 24px',
          boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
        }}
        initial={{ scale: 0.92, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'start',
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', marginBottom: 6 }}>
              {signal.degraded ? 'RULE FALLBACK' : 'AI SIGNAL'} · conf{' '}
              {(signal.confidence * 100).toFixed(0)}%
            </div>
            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em' }}>
              {signal.ticker}
            </div>
            <div style={{ marginTop: 6 }}>
              <span className={`badge ${actionClass}`}>{signal.action}</span>
            </div>
          </div>

          <TtlRing ratio={ratio} seconds={secondsLeft} />
        </div>

        <div
          style={{
            background: 'var(--color-bg-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 14,
            fontSize: 14,
            color: 'var(--color-fg-muted)',
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {signal.rationale}
        </div>

        {bars.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.3 }}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: '8px 6px 4px',
              marginBottom: 16,
            }}
          >
            <MiniChart
              bars={bars}
              height={140}
              marker={{
                price: signal.priceAtSignal,
                label: 'signal',
                color: markerColor,
              }}
            />
          </motion.div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          <Stat label="Signal price" value={`$${signal.priceAtSignal.toFixed(2)}`} />
          <Stat label="RSI(14)" value={signal.indicators.rsi?.toFixed(1) ?? 'n/a'} />
          <Stat
            label="MACD hist"
            value={signal.indicators.macd?.histogram.toFixed(2) ?? 'n/a'}
          />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1, padding: '16px 24px', fontSize: 16 }}
            disabled={executing}
            onClick={() => void submit(false)}
          >
            No, skip
          </button>
          <button
            className={signal.action === 'SELL' ? 'btn btn-sell' : 'btn btn-buy'}
            style={{ flex: 2, padding: '16px 24px', fontSize: 16 }}
            disabled={executing}
            onClick={() => void submit(true)}
          >
            {executing
              ? swapLoading === 'order'
                ? 'Quoting…'
                : swapLoading === 'sign'
                  ? 'Awaiting signature…'
                  : swapLoading === 'execute'
                    ? 'Submitting…'
                    : 'Executing…'
              : `Yes, execute ${signal.action}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TtlRing({ ratio, seconds }: { ratio: number; seconds: number }) {
  const size = 88;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * ratio;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-border)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ttlColor(ratio)}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke 200ms linear, stroke-dasharray 200ms linear' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: 20,
          color: ttlColor(ratio),
        }}
      >
        {seconds}s
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--color-bg-muted)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      <div style={{ color: 'var(--color-fg-muted)', fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(5, 6, 10, 0.72)',
  backdropFilter: 'blur(6px)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 9999,
  padding: 24,
};
