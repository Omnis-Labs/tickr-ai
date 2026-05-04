'use client';

import { motion } from 'framer-motion';
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
import { TopAppBar } from '@/components/shell/top-app-bar';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { ensureNotificationPermission } from '@/lib/notifications/permission';

/**
 * Mandate setup / edit. Four cards: holding period, max drawdown, max
 * trade size, market focus. Hydrates from /api/mandates on mount; POST
 * for first-time, PUT once `submitted`. After save we ask for OS notif
 * permission while the user is in a high-intent moment, then bounce to /.
 */
export default function MandatePage() {
  const router = useRouter();
  const { address, connected } = useWallet();
  const demo = isDemo();
  const authedFetch = useAuthedFetch();

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [holdingPeriod, setHoldingPeriod] = useState<HoldingPeriod>('1-2 weeks');
  const [maxDrawdown, setMaxDrawdown] = useState<number | null>(0.05);
  const [maxTradeSize, setMaxTradeSize] = useState<string>('500');
  const [marketFocus, setMarketFocus] = useState<string[]>(['no_preference']);

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
        setMaxTradeSize(String(m.maxTradeSize));
        setMarketFocus(m.marketFocus ?? ['no_preference']);
        setSubmitted(true);
      })
      .catch(() => {});
  }, [address, demo, authedFetch]);

  const noPreference = marketFocus.includes('no_preference');
  const tradeSize = Number(maxTradeSize);

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
      !isNaN(tradeSize) &&
      tradeSize >= 10 &&
      marketFocus.length > 0 &&
      (connected || demo) &&
      !loading
    );
  }, [tradeSize, marketFocus, connected, demo, loading]);

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
      maxTradeSize: tradeSize,
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
      void ensureNotificationPermission();
      router.push('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const segmentItem = (active: boolean) =>
    `flex-1 flex items-center justify-center h-9 rounded-full text-label-md transition-colors duration-200 cursor-pointer ${
      active ? 'bg-primary text-on-primary' : 'bg-transparent text-on-surface hover:bg-surface-dim'
    }`;

  return (
    <>
      <TopAppBar
        title="Set up mandate"
        leftAction={
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="flex items-center justify-center w-11 h-11 rounded-full text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
        }
      />

      <main className="flex flex-col gap-4 px-5 pt-4 pb-32 max-w-md mx-auto">
        <Card icon="schedule" title="Holding period" delay={0}>
          <div className="grid grid-cols-2 gap-2">
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
        </Card>

        <Card icon="warning" title="Max drawdown" delay={0.05}>
          <div className="flex items-center w-full bg-surface-container-low rounded-full h-11 p-1">
            {MAX_DRAWDOWN_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setMaxDrawdown(opt.value)}
                className={segmentItem(maxDrawdown === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Card>

        <Card icon="account_balance" title="Max trade size" delay={0.1}>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-title-lg text-on-surface">
              $
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={maxTradeSize}
              onChange={(e) => setMaxTradeSize(e.target.value)}
              placeholder="0.00"
              min={10}
              step={10}
              className="pl-9 h-11 w-full rounded-full bg-surface-container-low border border-outline-variant focus-visible:border-primary focus-visible:outline-none text-title-md tabular-nums px-4"
            />
          </div>
          <p className="text-body-sm text-on-surface-variant mt-2">
            Hard upper bound for each proposal's suggested USD size.
          </p>
        </Card>

        <Card icon="public" title="Market focus" delay={0.15}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => toggleFocus('no_preference')}
              className={`h-9 px-4 rounded-full text-label-md transition-colors ${
                noPreference
                  ? 'bg-primary text-on-primary'
                  : 'bg-transparent text-on-surface border border-outline-variant'
              }`}
            >
              No preference
            </button>
            {MARKET_FOCUS_VERTICALS.map((v) => {
              const active = !noPreference && marketFocus.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggleFocus(v.id)}
                  disabled={noPreference}
                  className={`h-9 px-4 rounded-full text-label-md transition-colors ${
                    active
                      ? 'bg-primary text-on-primary'
                      : 'bg-transparent text-on-surface border border-outline-variant'
                  } ${noPreference ? 'opacity-45 pointer-events-none' : ''}`}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </Card>
      </main>

      <div className="fixed bottom-0 left-0 right-0 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 bg-gradient-to-t from-background via-background/85 to-transparent z-30">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="flex items-center justify-center gap-2 w-full h-14 rounded-full bg-accent text-on-accent text-title-md shadow-floating active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100"
          >
            {loading ? 'Saving…' : submitted ? 'Save changes' : 'Start Desk'}
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
          {!connected && !demo && (
            <p className="mt-2 text-center text-body-sm text-on-surface-variant">Connect a wallet to save.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Card({
  icon,
  title,
  delay,
  children,
}: {
  icon: string;
  title: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-surface rounded-lg p-5 shadow-soft flex flex-col gap-4"
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-surface-container text-on-surface">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        <h2 className="text-title-md text-on-surface">{title}</h2>
      </div>
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
  caption?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-4 py-3 text-left transition-colors ${
        selected
          ? 'border-primary bg-accent-soft text-on-surface'
          : 'border-outline-variant bg-surface-container hover:bg-surface-container-high text-on-surface'
      }`}
    >
      <div className="text-label-lg font-semibold">{title}</div>
      {caption && <div className="mt-0.5 text-body-sm text-on-surface-variant">{caption}</div>}
    </button>
  );
}
