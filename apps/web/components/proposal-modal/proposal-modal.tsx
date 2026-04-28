'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  DEMO_FAKE_MINT,
  SKIP_REASON_LABELS,
  USDC_DECIMALS,
  XSTOCKS,
  xStockToBare,
  type DemoProposalShape,
  type SkipReason,
  type XStockTicker,
} from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { isDemo, useDemoStore } from '@/lib/demo';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';

type ProposalUI = DemoProposalShape;

interface ProposalModalProps {
  proposal: ProposalUI | null;
  fallbackId?: string;
  onClose: (decision: 'placed' | 'skipped' | null) => void;
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

export function ProposalModal({ proposal, fallbackId, onClose }: ProposalModalProps) {
  const { publicKey } = useWallet();
  const { swap, loading: swapLoading } = useJupiterSwap();
  const [bars, setBars] = useState<ChartBar[]>([]);
  const [executing, setExecuting] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState<SkipReason>('TOO_RISKY');
  const [skipDetail, setSkipDetail] = useState('');

  // Editable form fields seeded from the proposal.
  const [size, setSize] = useState<number>(0);
  const [trigger, setTrigger] = useState<number>(0);
  const [tp, setTp] = useState<number>(0);
  const [sl, setSl] = useState<number>(0);

  useEffect(() => {
    if (!proposal) return;
    setSize(proposal.suggestedSizeUsd);
    setTrigger(proposal.suggestedTriggerPrice);
    setTp(proposal.suggestedTakeProfitPrice);
    setSl(proposal.suggestedStopLossPrice);
    let cancelled = false;
    const bare = xStockToBare(proposal.ticker as XStockTicker);
    fetch(`/api/bars/${bare}?resolution=5&hours=24`)
      .then((r) => (r.ok ? (r.json() as Promise<{ bars: ChartBar[] }>) : null))
      .then((j) => {
        if (!cancelled && j?.bars) setBars(j.bars);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [proposal?.id, proposal?.ticker]);

  const exitTtl = useMemo(() => {
    if (!proposal) return null;
    const remainMs = new Date(proposal.expiresAt).getTime() - Date.now();
    if (remainMs <= 0) return 'Expired';
    const m = Math.floor(remainMs / 60_000);
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  }, [proposal?.expiresAt]);

  if (!proposal) {
    return (
      <motion.div
        style={overlayStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      >
        <motion.div
          className="card"
          style={{ maxWidth: 420 }}
          initial={{ scale: 0.94, y: 12, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Proposal not found</h2>
          <p style={{ color: 'var(--color-fg-muted)', marginBottom: 16 }}>
            {fallbackId ? (
              <>
                This proposal has expired or wasn't received by this tab:{' '}
                <code style={{ fontSize: 12 }}>{fallbackId}</code>.
              </>
            ) : (
              <>No proposal id provided.</>
            )}
          </p>
          <button className="btn btn-ghost" onClick={() => onClose(null)}>
            Close
          </button>
        </motion.div>
      </motion.div>
    );
  }

  const meta = XSTOCKS[xStockToBare(proposal.ticker as XStockTicker)];
  const demo = isDemo();
  const walletKey = publicKey?.toBase58() ?? (demo ? 'demo-wallet' : null);

  const sizeWarning =
    size > 500 ? `Above your $500 max trade size — proceed with caution.` : null;

  const tpPctRaw = trigger > 0 ? ((tp - trigger) / trigger) * 100 : 0;
  const slPctRaw = trigger > 0 ? ((sl - trigger) / trigger) * 100 : 0;
  const tpPct = Number.isFinite(tpPctRaw) ? tpPctRaw : 0;
  const slPct = Number.isFinite(slPctRaw) ? slPctRaw : 0;
  const rr = sl > 0 && trigger > sl && tp > trigger ? (tp - trigger) / (trigger - sl) : null;

  async function handlePlace() {
    if (!walletKey) {
      toast.error('Connect a wallet to place orders.');
      return;
    }
    if (!meta) {
      toast.error(`Unknown ticker ${proposal!.ticker}`);
      return;
    }
    const mintForSwap = meta.mint || (demo ? DEMO_FAKE_MINT : '');
    if (!mintForSwap) {
      toast.error(
        `${meta.symbol} mint is empty — run \`pnpm --filter @hunch-it/ws-server verify:xstocks\`.`,
      );
      return;
    }
    setExecuting(true);
    try {
      // v1.3 NOTE: this still uses the legacy Jupiter Ultra path. Phase C
      // replaces it with Trigger Order v2 (BUY trigger + auto TP/SL OCO).
      const result = await swap({
        direction: 'BUY',
        xStockMint: mintForSwap,
        xStockDecimals: meta.decimals,
        usdAmount: size,
      });

      const tokenAmount = Number(result.outputAmount) / 10 ** meta.decimals;
      const usdValue = Number(result.inputAmount) / 10 ** USDC_DECIMALS;
      const executionPrice = tokenAmount > 0 ? usdValue / tokenAmount : trigger;

      if (demo) {
        useDemoStore.getState().appendTrade({
          signalId: proposal!.id,
          ticker: proposal!.ticker,
          side: 'BUY',
          amountUsd: usdValue,
          tokenAmount,
          executionPrice,
          realizedPnl: 0,
          txSignature: result.exec.signature ?? `demo-${Date.now()}`,
          status: result.exec.status === 'Success' ? 'CONFIRMED' : 'FAILED',
        });
      }
      // Live persistence (Trade table writes) is wired in Phase C alongside
      // the Trigger Order pipeline.

      if (result.exec.status === 'Success') {
        toast.success(
          `BUY ${proposal!.ticker} placed${demo ? ' (demo)' : ''}. TP/SL will attach on fill.`,
        );
      } else {
        toast.error(`Order failed: ${result.exec.error ?? 'unknown'}`);
      }
      onClose('placed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  async function handleSkip() {
    if (!walletKey) {
      toast.error('Connect a wallet first.');
      return;
    }
    if (!demo) {
      void fetch('/api/skips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          walletAddress: walletKey,
          proposalId: proposal!.id,
          reason: skipReason,
          detail: skipReason === 'OTHER' ? skipDetail : undefined,
        }),
      }).catch(() => {});
    }
    toast(`Proposal skipped (${SKIP_REASON_LABELS[skipReason] ?? skipReason})`);
    onClose('skipped');
  }

  const markerColor = '#22c55e'; // BUY
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
          width: 'min(720px, 94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '28px 32px 24px',
          boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
        }}
        initial={{ scale: 0.94, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', letterSpacing: '0.06em' }}>
              AI PROPOSAL · conf {(proposal.confidence * 100).toFixed(0)}%
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' }}>
              {proposal.ticker}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
              {meta?.name ?? '—'}
            </div>
            <div style={{ marginTop: 6 }}>
              <span className="badge badge-buy">BUY</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--color-fg-muted)' }}>Expires in</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{exitTtl ?? '—'}</div>
          </div>
        </div>

        {/* Rationale */}
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
          {proposal.rationale}
        </div>

        {/* Chart */}
        {bars.length > 0 && (
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: '8px 6px 4px',
              marginBottom: 16,
            }}
          >
            <MiniChart
              bars={bars}
              height={150}
              marker={{
                price: proposal.priceAtProposal,
                label: 'price@proposal',
                color: markerColor,
              }}
            />
          </div>
        )}

        {/* Reasoning — 3 sections */}
        <Section title="What changed">{proposal.reasoning.what_changed}</Section>
        <Section title="Why this trade">{proposal.reasoning.why_this_trade}</Section>
        <Section title="Why it fits your mandate" accent>
          {proposal.reasoning.why_fits_mandate}
        </Section>

        {/* Position impact */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            margin: '12px 0 18px',
            fontSize: 13,
          }}
        >
          <Stat
            label="Weight"
            value={`${(proposal.positionImpact.weight_before * 100).toFixed(1)}% → ${(proposal.positionImpact.weight_after * 100).toFixed(1)}%`}
          />
          <Stat
            label="Cash after"
            value={`$${proposal.positionImpact.cash_after.toFixed(0)}`}
          />
          <Stat
            label="Sector"
            value={`${(proposal.positionImpact.sector_before * 100).toFixed(0)}% → ${(proposal.positionImpact.sector_after * 100).toFixed(0)}%`}
          />
        </div>

        {/* Editable parameters */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <NumField
            label="Size (USDC)"
            value={size}
            onChange={setSize}
            warning={sizeWarning}
            step={10}
          />
          <NumField label="Trigger price" value={trigger} onChange={setTrigger} step={0.5} />
          <NumField
            label={`Take profit ${tp > trigger ? `(+${tpPct.toFixed(1)}%)` : ''}`}
            value={tp}
            onChange={setTp}
            step={0.5}
            color="var(--color-buy)"
          />
          <NumField
            label={`Stop loss ${sl > 0 && trigger > sl ? `(${slPct.toFixed(1)}%)` : ''}`}
            value={sl}
            onChange={setSl}
            step={0.5}
            color="var(--color-sell)"
          />
        </div>
        {rr != null && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-fg-muted)',
              marginBottom: 18,
            }}
          >
            Risk / reward ratio: <strong>{rr.toFixed(2)}x</strong> (reward / risk)
          </div>
        )}

        {/* Actions */}
        {!skipOpen ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn btn-ghost"
              style={{ flex: 1, padding: '14px 24px', fontSize: 15 }}
              disabled={executing}
              onClick={() => setSkipOpen(true)}
            >
              Skip
            </button>
            <button
              className="btn btn-buy"
              style={{ flex: 2, padding: '14px 24px', fontSize: 15 }}
              disabled={executing || size <= 0}
              onClick={() => void handlePlace()}
            >
              {executing
                ? swapLoading === 'order'
                  ? 'Quoting…'
                  : swapLoading === 'sign'
                    ? 'Awaiting signature…'
                    : swapLoading === 'execute'
                      ? 'Submitting…'
                      : 'Placing…'
                : 'Place order'}
            </button>
          </div>
        ) : (
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Why are you skipping?</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {(Object.keys(SKIP_REASON_LABELS) as SkipReason[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setSkipReason(r)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    background:
                      skipReason === r ? 'rgba(124,92,255,0.18)' : 'var(--color-bg-muted)',
                    border: `1px solid ${skipReason === r ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    color: 'var(--color-fg)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {SKIP_REASON_LABELS[r]}
                </button>
              ))}
            </div>
            {skipReason === 'OTHER' && (
              <input
                type="text"
                placeholder="Tell us why…"
                value={skipDetail}
                onChange={(e) => setSkipDetail(e.target.value)}
                style={{
                  width: '100%',
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--color-bg-muted)',
                  color: 'var(--color-fg)',
                  border: '1px solid var(--color-border)',
                }}
              />
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setSkipOpen(false)}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => void handleSkip()}
              >
                Submit skip
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Section({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          color: accent ? 'var(--color-accent-strong)' : 'var(--color-fg-muted)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</div>
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
        padding: '8px 10px',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--color-fg-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{value}</div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  warning,
  step,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  warning?: string | null;
  step?: number;
  color?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: color ?? 'var(--color-fg-muted)' }}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          padding: 10,
          borderRadius: 8,
          background: 'var(--color-bg-muted)',
          color: 'var(--color-fg)',
          border: `1px solid ${warning ? 'var(--color-warn)' : 'var(--color-border)'}`,
        }}
      />
      {warning && (
        <span style={{ fontSize: 11, color: 'var(--color-warn)' }}>{warning}</span>
      )}
    </label>
  );
}
