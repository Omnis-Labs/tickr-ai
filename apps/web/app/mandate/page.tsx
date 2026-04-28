'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  HOLDING_PERIOD_OPTIONS,
  MARKET_FOCUS_VERTICALS,
  MAX_DRAWDOWN_OPTIONS,
  type HoldingPeriod,
  type MandateInput,
} from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo';

/**
 * Screen 1 — Mandate Setup
 * Four sub-sections: holding period / max drawdown / max trade size / market focus
 * On submit POSTs /api/mandates and redirects to /.
 */
export default function MandatePage() {
  const router = useRouter();
  const { address, connected } = useWallet();
  const demo = isDemo();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [holdingPeriod, setHoldingPeriod] = useState<HoldingPeriod>('1-2 weeks');
  const [maxDrawdown, setMaxDrawdown] = useState<number | null>(0.05);
  const [maxTradeSize, setMaxTradeSize] = useState<number>(500);
  const [marketFocus, setMarketFocus] = useState<string[]>(['no_preference']);

  // Hydrate from existing mandate (edit mode).
  useEffect(() => {
    const wallet = demo ? 'demo-wallet' : address;
    if (!wallet) return;
    fetch(`/api/mandates?wallet=${wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const m = j?.mandate;
        if (!m) return;
        setHoldingPeriod(m.holdingPeriod);
        setMaxDrawdown(m.maxDrawdown ?? null);
        setMaxTradeSize(m.maxTradeSize);
        setMarketFocus(m.marketFocus ?? ['no_preference']);
      })
      .catch(() => {});
  }, [address, demo]);

  const noPreference = marketFocus.includes('no_preference');

  function toggleFocus(id: string) {
    if (id === 'no_preference') {
      setMarketFocus(['no_preference']);
      return;
    }
    setMarketFocus((cur) => {
      const next = cur.filter((x) => x !== 'no_preference');
      return next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
    });
  }

  const canSubmit = useMemo(() => {
    return (
      maxTradeSize > 0 &&
      marketFocus.length > 0 &&
      (connected || demo) &&
      !loading
    );
  }, [maxTradeSize, marketFocus, connected, demo, loading]);

  async function submit() {
    const wallet = demo ? `demo-${'wallet'.padEnd(40, '0')}` : address;
    if (!wallet) {
      toast.error('Connect a wallet first.');
      return;
    }
    const payload: MandateInput & { walletAddress: string } = {
      walletAddress: wallet,
      holdingPeriod,
      maxDrawdown,
      maxTradeSize,
      marketFocus: marketFocus as MandateInput['marketFocus'],
    };
    setLoading(true);
    try {
      const res = await fetch('/api/mandates', {
        method: submitted ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `${res.status}`);
      }
      toast.success('Mandate saved.');
      setSubmitted(true);
      router.push('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginTop: 16, marginBottom: 32 }}
      >
        <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', marginBottom: 4 }}>
          MANDATE SETUP
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Define your trading mandate
        </h1>
        <p
          style={{
            color: 'var(--color-fg-muted)',
            marginTop: 8,
            fontSize: 15,
            maxWidth: 560,
          }}
        >
          Tell the AI signal engine how you want to trade. Every BUY proposal will be sized,
          priced, and reasoned against these parameters.
        </p>
      </motion.div>

      {/* 1A. Holding period */}
      <Section
        step={1}
        total={4}
        title="Holding period"
        sub="Influences proposal expiry and how aggressive TP / SL bands are set."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {HOLDING_PERIOD_OPTIONS.map((opt) => (
            <Choice
              key={opt.value}
              selected={holdingPeriod === opt.value}
              onClick={() => setHoldingPeriod(opt.value as HoldingPeriod)}
              title={opt.label}
              caption={opt.caption}
            />
          ))}
        </div>
      </Section>

      {/* 1B. Max drawdown */}
      <Section
        step={2}
        total={4}
        title="Max drawdown"
        sub="Risk tolerance — bounds the suggested SL price for each proposal."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {MAX_DRAWDOWN_OPTIONS.map((opt) => (
            <Choice
              key={String(opt.value)}
              selected={maxDrawdown === opt.value}
              onClick={() => setMaxDrawdown(opt.value)}
              title={opt.label}
              caption=""
            />
          ))}
        </div>
      </Section>

      {/* 1C. Max trade size */}
      <Section
        step={3}
        total={4}
        title="Max trade size"
        sub="Hard upper bound for each proposal's suggested USD size."
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 280 }}>
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>USD per trade</span>
          <input
            type="number"
            min={10}
            step={10}
            value={maxTradeSize}
            onChange={(e) => setMaxTradeSize(Number(e.target.value))}
            style={inputStyle}
          />
        </label>
      </Section>

      {/* 1D. Market focus */}
      <Section
        step={4}
        total={4}
        title="Market focus"
        sub="Which verticals should the engine watch for opportunities? Multi-select."
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <Choice
            selected={noPreference}
            onClick={() => toggleFocus('no_preference')}
            title="No preference"
            caption="Watch every supported asset"
          />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
            opacity: noPreference ? 0.45 : 1,
            pointerEvents: noPreference ? 'none' : 'auto',
          }}
        >
          {MARKET_FOCUS_VERTICALS.map((v) => (
            <Choice
              key={v.id}
              selected={!noPreference && marketFocus.includes(v.id)}
              onClick={() => toggleFocus(v.id)}
              title={v.label}
              caption={`${v.tickers.length} tickers`}
            />
          ))}
        </div>
      </Section>

      <div style={{ marginTop: 32, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          className="btn btn-primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
          style={{ padding: '14px 28px', fontSize: 16 }}
        >
          {loading ? 'Saving…' : 'Start Desk →'}
        </button>
        {!connected && !demo && (
          <span style={{ color: 'var(--color-warn)', fontSize: 13 }}>
            Connect a wallet to save.
          </span>
        )}
      </div>
    </main>
  );
}

function Section({
  step,
  total,
  title,
  sub,
  children,
}: {
  step: number;
  total: number;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: step * 0.05 }}
      style={{ marginBottom: 32 }}
    >
      <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', letterSpacing: '0.06em' }}>
        {step}/{total}
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 4px' }}>{title}</h2>
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginBottom: 16 }}>{sub}</p>
      {children}
    </motion.section>
  );
}

function Choice({
  selected,
  onClick,
  title,
  caption,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  caption: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 10,
        background: selected ? 'rgba(124,92,255,0.16)' : 'var(--color-bg-muted)',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        color: 'var(--color-fg)',
        cursor: 'pointer',
        transition: 'background 120ms ease, border 120ms ease',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
      {caption && (
        <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', marginTop: 2 }}>
          {caption}
        </div>
      )}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: 'var(--color-bg-muted)',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  fontSize: 16,
};
