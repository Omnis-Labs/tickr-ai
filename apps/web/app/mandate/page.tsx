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
import { useAuthedFetch } from '@/lib/auth/fetch';
import { ensureNotificationPermission } from '@/lib/notifications/permission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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
  const authedFetch = useAuthedFetch();

  // Hydrate from existing mandate (edit mode).
  useEffect(() => {
    const wallet = demo ? 'demo-wallet' : address;
    if (!wallet) return;
    authedFetch(`/api/mandates`)
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
  }, [address, demo, authedFetch]);

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
      const res = await authedFetch('/api/mandates', {
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
      // The user just signalled they want our proposals. Best moment to
      // ask for OS notification permission — granted now, hidden-tab
      // alerts work for the lifetime of the session.
      void ensureNotificationPermission();
      router.push('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-[720px] px-6 py-12">
      <Link href="/" className="text-sm text-on-surface-variant hover:text-on-surface">
        ← Home
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-4 mb-8"
      >
        <div className="mb-1 text-xs uppercase tracking-wider text-on-surface-variant">
          MANDATE SETUP
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight">Define your trading mandate</h1>
        <p className="mt-2 max-w-[560px] text-base text-on-surface-variant">
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
        <label className="flex max-w-[280px] flex-col gap-2">
          <span className="text-sm text-on-surface-variant">USD per trade</span>
          <Input
            type="number"
            min={10}
            step={10}
            value={maxTradeSize}
            onChange={(e) => setMaxTradeSize(Number(e.target.value))}
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

      <div className="mt-8 flex items-center gap-3">
        <Button size="lg" disabled={!canSubmit} onClick={() => void submit()}>
          {loading ? 'Saving…' : 'Start Desk →'}
        </Button>
        {!connected && !demo && (
          <span className="text-sm text-positive">Connect a wallet to save.</span>
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
      className="mb-8"
    >
      <div className="text-xs uppercase tracking-wider text-on-surface-variant">
        {step}/{total}
      </div>
      <h2 className="mt-1 mb-1 text-xl font-bold">{title}</h2>
      <p className="mb-4 text-sm text-on-surface-variant">{sub}</p>
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
      className={cn(
        'rounded-lg border bg-surface-container px-4 py-3 text-left text-on-surface transition-colors',
        selected
          ? 'border-primary bg-accent-soft'
          : 'border-outline-variant hover:bg-surface-container-high',
      )}
    >
      <div className="text-base font-semibold">{title}</div>
      {caption && (
        <div className="mt-0.5 text-xs text-on-surface-variant">{caption}</div>
      )}
    </button>
  );
}
