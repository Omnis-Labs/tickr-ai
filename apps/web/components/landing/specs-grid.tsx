'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

const SPECS = [
  {
    label: 'Tokenized stocks',
    body: 'xStocks via Backed Finance. 25+ US tickers and ETFs settled on Solana, redeemable 1 to 1 with shares held in an EU regulated vault.',
  },
  {
    label: 'Pricing',
    body: 'Pyth Network real-time feeds, sub-second updates, the same oracle the rest of the chain trusts.',
  },
  {
    label: 'Execution',
    body: 'Jupiter Ultra swaps, MEV-aware routing, every transaction signed by your wallet at the moment of tap.',
  },
  {
    label: 'Custody',
    body: 'Self-custodial via Privy embedded wallet. Keys stay with you; recoverable via email or socials, transferable to your own wallet at any time.',
  },
  {
    label: 'Strategy',
    body: 'Take-profit and stop-loss arm in the same step as the buy. One cancels the other when the trade resolves, so a fill never leaves you exposed.',
  },
  {
    label: 'Open source',
    body: 'AGPL-3.0. The engine, the synthetic-trigger architecture, and the proposal pipeline are all readable in a browser tab.',
  },
] as const;

const easeOutQuart = [0.25, 1, 0.5, 1] as const;

export function SpecsGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <section id="why-us" className="mx-auto max-w-[1200px] px-6 pb-32 pt-24 sm:px-10 sm:pt-32">
      <div className="mb-20 flex items-baseline gap-3">
        <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
          03
        </span>
        <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
          /
        </span>
        <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
          Built on, not behind
        </span>
      </div>

      <motion.h2
        ref={ref}
        initial={{ opacity: 0, y: 14 }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={{ duration: 0.7, ease: easeOutQuart }}
        className="mb-7 font-semibold tracking-[-0.03em] text-on-background"
        style={{
          fontSize: 'clamp(40px, 7vw, 96px)',
          lineHeight: 1.02,
        }}
      >
        Your wallet. Your mandate. Your edge.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.7, ease: easeOutQuart, delay: 0.12 }}
        className="mb-24 max-w-[58ch] text-body-lg text-on-surface-variant sm:text-[19px] sm:leading-[1.5]"
      >
        Permissionless by design, open to anyone, anywhere on Earth. No accreditation gate, no
        approved-jurisdictions list, no broker between you and the trade.
      </motion.p>

      <div className="grid grid-cols-1 gap-x-16 gap-y-12 sm:grid-cols-2">
        {SPECS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
            transition={{
              duration: 0.6,
              ease: easeOutQuart,
              delay: 0.2 + i * 0.06,
            }}
            className="border-t border-outline-variant pt-7"
          >
            <div className="mb-2.5 flex items-baseline gap-3">
              <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="text-title-lg font-semibold text-on-background">{s.label}</h3>
            </div>
            <p className="max-w-[44ch] text-body-md leading-[1.55] text-on-surface-variant">
              {s.body}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
