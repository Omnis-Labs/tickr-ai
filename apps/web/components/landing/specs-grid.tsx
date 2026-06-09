'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { proposalChecklist } from '@/lib/narrative/copy';

const SPECS = [
  {
    label: 'AI Analysts',
    body: 'Choose analysts that fit your style. Each watches different data sources and uses a different trading technique.',
  },
  {
    label: 'Bring your idea',
    body: 'Start from friends, creators, social feeds, or a market move, then ask your team to challenge the claim.',
  },
  {
    label: 'Market watch',
    body: 'Analysts can also watch the market and send proposals when a setup fits your mandate.',
  },
  {
    label: 'Proposal controls',
    body: proposalChecklist.join(', ') + '.',
  },
  {
    label: 'Execution path',
    body: 'Approve only after review. Synthetic orders watch the trigger, then tap-to-execute or Auto-execute triggers can handle the fill.',
  },
  {
    label: 'Self-custody',
    body: 'Your wallet stays yours. Hunch It proposes; you review, edit, approve, or skip.',
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
          What Hunch It does
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
        From should I follow this to one proposal.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.7, ease: easeOutQuart, delay: 0.12 }}
        className="mb-24 max-w-[58ch] text-body-lg text-on-surface-variant sm:text-[19px] sm:leading-[1.5]"
      >
        Gen Z hears trades from friends and creators. Hunch It helps verify the claim and fill in
        the details before the user becomes exit liquidity.
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
