'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

const PROPOSALS = [
  {
    ticker: 'NVDA',
    label: 'NVIDIA',
    size: '2.4',
    trigger: '$187.20',
    tp: '+8%',
    sl: '−5%',
    reasoning:
      'Earnings momentum breaking overhead resistance. Tech sector rotation confirms strength.',
  },
  {
    ticker: 'AAPL',
    label: 'Apple',
    size: '1.8',
    trigger: '$224.50',
    tp: '+6%',
    sl: '−4%',
    reasoning:
      'Services revenue inflecting, holiday cycle setting up. Mandate fits 2 to 8 week horizon.',
  },
  {
    ticker: 'MSFT',
    label: 'Microsoft',
    size: '2.1',
    trigger: '$418.80',
    tp: '+7%',
    sl: '−5%',
    reasoning:
      'Azure beat and AI capex narrative reset. Volume profile clean above 415.',
  },
  {
    ticker: 'TSLA',
    label: 'Tesla',
    size: '1.5',
    trigger: '$248.90',
    tp: '+10%',
    sl: '−6%',
    reasoning:
      'Delivery print de-risked, energy storage growing fast. Sized down for higher volatility.',
  },
  {
    ticker: 'SOL',
    label: 'Solana',
    size: '3.0',
    trigger: '$172.40',
    tp: '+12%',
    sl: '−7%',
    reasoning:
      'On-chain fee rev at multi-month highs, validator queue thinning. Bluechip crypto allocation.',
  },
] as const;

const easeOutQuart = [0.25, 1, 0.5, 1] as const;
const N = PROPOSALS.length;

export function ProposalStack() {
  const reduce = useReducedMotion();
  const [top, setTop] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setTop((t) => (t + 1) % N);
    }, 5200);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <section className="mx-auto max-w-[1200px] px-6 pb-32 pt-12 sm:px-10 sm:pt-16">
      <div className="mb-16 flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
            02
          </span>
          <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
            /
          </span>
          <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
            A real proposal
          </span>
        </div>
        <span className="rounded-full bg-surface-container px-3 py-1 font-mono text-label-md text-on-surface-variant">
          SAMPLE
        </span>
      </div>

      <div className="grid items-center gap-12 sm:grid-cols-[1fr_1.1fr] sm:gap-20">
        <div>
          <h3
            className="mb-6 font-semibold tracking-[-0.02em] text-on-background"
            style={{
              fontSize: 'clamp(32px, 5vw, 56px)',
              lineHeight: 1.04,
            }}
          >
            Sized to your book.
            <br />
            Reasoned in plain English.
          </h3>
          <p className="max-w-[44ch] text-body-lg text-on-surface-variant sm:text-[17px] sm:leading-[1.55]">
            Each proposal arrives as a complete strategy: a single ticker, sized
            against your mandate, a trigger price, take-profit, stop-loss, and a
            short reason you can sanity-check before you tap.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <span className="font-mono text-label-md text-on-surface-variant">
              {String(top + 1).padStart(2, '0')} / {String(N).padStart(2, '0')}
            </span>
            <div className="h-px flex-1 bg-outline-variant" />
            <span className="font-mono text-label-md text-on-surface-variant">
              auto · 5s
            </span>
          </div>
        </div>

        <div className="relative h-[440px] w-full">
          {PROPOSALS.map((p, idx) => {
            const slot = (idx - top + N) % N;
            const onTop = slot === 0;
            return (
              <motion.div
                key={p.ticker}
                className="absolute inset-x-0 top-0 mx-auto w-full max-w-[440px]"
                animate={{
                  y: onTop ? 0 : 16 + slot * 8,
                  scale: onTop ? 1 : 1 - slot * 0.025,
                  opacity: onTop ? 1 : Math.max(0.08, 1 - slot * 0.22),
                }}
                transition={{
                  duration: reduce ? 0 : 0.85,
                  ease: easeOutQuart,
                }}
                style={{
                  zIndex: N - slot,
                  pointerEvents: onTop ? 'auto' : 'none',
                }}
              >
                <ProposalCard data={p} />
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ProposalCard({ data }: { data: (typeof PROPOSALS)[number] }) {
  return (
    <article className="rounded-[28px] bg-accent p-7 text-on-accent shadow-soft">
      <div className="mb-5 flex items-center justify-between">
        <span className="font-mono text-label-sm uppercase tracking-[0.18em]">
          Buy proposal
        </span>
        <span className="rounded-full bg-on-accent/10 px-3 py-1 font-mono text-label-md">
          {data.ticker}
        </span>
      </div>

      <div className="mb-1 font-semibold leading-none tracking-[-0.03em]">
        <span className="font-mono text-[56px]">{data.size}</span>
        <span className="ml-1 font-mono text-[28px] opacity-60">%</span>
      </div>
      <div className="mb-6 text-body-md opacity-70">
        of book to {data.label} at {data.trigger}
      </div>

      <p className="mb-7 max-w-[36ch] text-body-md leading-[1.5] opacity-90">
        {data.reasoning}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-on-accent/10 p-3.5">
          <div className="mb-0.5 font-mono text-label-sm uppercase tracking-wider opacity-70">
            Take profit
          </div>
          <div className="font-mono text-title-lg">{data.tp}</div>
        </div>
        <div className="rounded-2xl bg-on-accent/10 p-3.5">
          <div className="mb-0.5 font-mono text-label-sm uppercase tracking-wider opacity-70">
            Stop loss
          </div>
          <div className="font-mono text-title-lg">{data.sl}</div>
        </div>
      </div>
    </article>
  );
}
