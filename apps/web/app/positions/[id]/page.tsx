'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { isDemo } from '@/lib/demo';
import { useDemoPositionsStore, type DemoPositionUI } from '@/lib/demo/positions';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';

export default function PositionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const demo = isDemo();
  const position = useDemoPositionsStore((s) =>
    params?.id ? s.positions.find((p) => p.id === params.id) ?? null : null,
  );
  const adjustTpSl = useDemoPositionsStore((s) => s.adjustTpSl);
  const closePosition = useDemoPositionsStore((s) => s.closePosition);

  const [bars, setBars] = useState<ChartBar[]>([]);
  const [tpDraft, setTpDraft] = useState('');
  const [slDraft, setSlDraft] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!position) return;
    setTpDraft(position.currentTpPrice?.toString() ?? '');
    setSlDraft(position.currentSlPrice?.toString() ?? '');
    let cancelled = false;
    const bare = xStockToBare(position.ticker as XStockTicker);
    fetch(`/api/bars/${bare}?resolution=5&hours=24`)
      .then((r) => (r.ok ? (r.json() as Promise<{ bars: ChartBar[] }>) : null))
      .then((j) => {
        if (!cancelled && j?.bars) setBars(j.bars);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [position?.id, position?.ticker]);

  const meta = position
    ? XSTOCKS[xStockToBare(position.ticker as XStockTicker)]
    : null;

  const computed = useMemo(() => {
    if (!position) return null;
    const value = position.tokenAmount * position.markPrice;
    const unrealized = (position.markPrice - position.entryPrice) * position.tokenAmount;
    const unrealizedPct =
      position.entryPrice > 0
        ? ((position.markPrice - position.entryPrice) / position.entryPrice) * 100
        : 0;
    const days = Math.max(
      0,
      Math.floor((Date.now() - new Date(position.firstEntryAt).getTime()) / (24 * 3600 * 1000)),
    );
    const drawdownFromPeak =
      position.markPrice >= position.entryPrice
        ? 0
        : ((position.markPrice - position.entryPrice) / position.entryPrice) * 100;
    return { value, unrealized, unrealizedPct, days, drawdownFromPeak };
  }, [position]);

  if (!position) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
        <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
          ← Home
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '16px 0' }}>Position not found</h1>
        <p style={{ color: 'var(--color-fg-muted)' }}>
          This position has been closed or doesn't exist on this device.
        </p>
      </main>
    );
  }

  const markerColor = '#22c55e';
  const stateBadge =
    position.state === 'ACTIVE'
      ? { bg: 'rgba(34,197,94,0.18)', fg: 'var(--color-buy)', label: 'Active' }
      : position.state === 'BUY_PENDING'
        ? { bg: 'rgba(245,158,11,0.18)', fg: 'var(--color-warn)', label: 'Buy pending' }
        : position.state === 'ENTERING'
          ? { bg: 'rgba(245,158,11,0.18)', fg: 'var(--color-warn)', label: 'Entering' }
          : position.state === 'CLOSING'
            ? { bg: 'rgba(245,158,11,0.18)', fg: 'var(--color-warn)', label: 'Closing' }
            : { bg: 'rgba(144,153,173,0.18)', fg: 'var(--color-fg-muted)', label: 'Closed' };

  async function submitTpSl() {
    const tp = tpDraft === '' ? null : Number(tpDraft);
    const sl = slDraft === '' ? null : Number(slDraft);
    if (tp != null && (!Number.isFinite(tp) || tp <= 0)) {
      toast.error('TP must be a positive number');
      return;
    }
    if (sl != null && (!Number.isFinite(sl) || sl <= 0)) {
      toast.error('SL must be a positive number');
      return;
    }
    setBusy(true);
    try {
      if (!demo) {
        toast.error(
          'Live TP/SL adjust is wired in Phase D (Jupiter Trigger Order in-place edit).',
        );
        return;
      }
      adjustTpSl(position.id, tp, sl);
      toast.success('TP / SL updated.');
    } finally {
      setBusy(false);
    }
  }

  async function doClose() {
    setBusy(true);
    try {
      if (!demo) {
        const res = await fetch(`/api/positions/${position.id}/close`, { method: 'POST' });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error ?? `${res.status}`);
          return;
        }
      }
      closePosition(position.id, 'USER_CLOSE', position.markPrice);
      toast.success(`${position.ticker} closed.`);
      router.replace('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginTop: 16, marginBottom: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {position.ticker}
          </h1>
          <span
            style={{
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              background: stateBadge.bg,
              color: stateBadge.fg,
            }}
          >
            {stateBadge.label}
          </span>
        </div>
        <div style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginTop: 4 }}>
          {meta?.name ?? '—'}
        </div>
      </motion.div>

      {/* Chart with annotations */}
      {bars.length > 0 && (
        <div
          className="card"
          style={{ padding: '8px 6px 4px', marginBottom: 16 }}
        >
          <MiniChart
            bars={bars}
            height={180}
            marker={{
              price: position.entryPrice,
              label: 'entry',
              color: markerColor,
            }}
          />
        </div>
      )}

      {/* Position info */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Position</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Stat label="Quantity" value={`${position.tokenAmount.toFixed(4)} ${position.ticker}`} />
          <Stat label="Entry price" value={`$${position.entryPrice.toFixed(2)}`} />
          <Stat label="Mark price" value={`$${position.markPrice.toFixed(2)}`} />
          <Stat label="Value" value={`$${computed!.value.toFixed(2)}`} />
          <Stat
            label="Unrealised P&L"
            value={`${computed!.unrealized >= 0 ? '+' : ''}$${computed!.unrealized.toFixed(2)} (${computed!.unrealizedPct.toFixed(1)}%)`}
            color={computed!.unrealized >= 0 ? 'var(--color-buy)' : 'var(--color-sell)'}
          />
          <Stat label="Days held" value={`${computed!.days}`} />
          <Stat
            label="Take profit"
            value={position.currentTpPrice ? `$${position.currentTpPrice.toFixed(2)}` : '—'}
            color="var(--color-buy)"
          />
          <Stat
            label="Stop loss"
            value={position.currentSlPrice ? `$${position.currentSlPrice.toFixed(2)}` : '—'}
            color="var(--color-sell)"
          />
        </div>
      </div>

      {/* Adjust TP / SL */}
      {position.state === 'ACTIVE' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Adjust TP / SL</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <NumField label="Take profit" value={tpDraft} onChange={setTpDraft} color="var(--color-buy)" />
            <NumField label="Stop loss" value={slDraft} onChange={setSlDraft} color="var(--color-sell)" />
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submitTpSl()}
            >
              Update
            </button>
          </div>
        </div>
      )}

      {/* Stock intro */}
      {meta && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>About</h2>
          <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, lineHeight: 1.6 }}>
            {position.ticker} is the on-chain representation of {meta.name} on Solana. Trades
            against USDC via Jupiter; underlying exposure is held by the issuer.
          </p>
        </div>
      )}

      {/* Close Position */}
      {position.state === 'ACTIVE' && (
        <div className="card">
          {!confirmClose ? (
            <button
              className="btn btn-sell"
              style={{ width: '100%', padding: '14px 24px', fontSize: 15 }}
              onClick={() => setConfirmClose(true)}
            >
              Close position
            </button>
          ) : (
            <div>
              <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginBottom: 12 }}>
                Cancel both exit orders and sell the full position at market price?
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setConfirmClose(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-sell"
                  style={{ flex: 2 }}
                  onClick={() => void doClose()}
                  disabled={busy}
                >
                  {busy ? 'Closing…' : 'Confirm close'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {position.state === 'CLOSED' && (
        <div className="card" style={{ background: 'var(--color-bg-muted)' }}>
          <div style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
            Closed via {position.closedReason ?? '—'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
            Realised P&L:{' '}
            <span
              style={{
                color:
                  (position.realizedPnl ?? 0) >= 0 ? 'var(--color-buy)' : 'var(--color-sell)',
              }}
            >
              {(position.realizedPnl ?? 0) >= 0 ? '+' : ''}$
              {(position.realizedPnl ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color ?? 'var(--color-fg)' }}>{value}</div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  color?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: color ?? 'var(--color-fg-muted)' }}>{label}</span>
      <input
        type="number"
        value={value}
        step={0.5}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: 10,
          borderRadius: 8,
          background: 'var(--color-bg-muted)',
          color: 'var(--color-fg)',
          border: '1px solid var(--color-border)',
        }}
      />
    </label>
  );
}
