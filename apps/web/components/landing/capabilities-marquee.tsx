'use client';

import { motion, useReducedMotion } from 'framer-motion';

const ITEMS = [
  'Mandate-first sizing',
  'TP / SL pre-armed',
  'OCO exits',
  'Pyth pricing',
  'Jupiter Ultra',
  'Solana mainnet',
  'Open source',
  'Self-custodial',
  'Synthetic-trigger orders',
  'Tap-to-execute',
  '25+ xStocks',
  'Permissionless',
] as const;

export function CapabilitiesMarquee() {
  const reduce = useReducedMotion();

  return (
    <section
      aria-label="Hunch It capabilities"
      className="group relative overflow-hidden border-y border-outline-variant bg-surface-container-low py-7"
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-surface-container-low to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-surface-container-low to-transparent"
        aria-hidden
      />

      <motion.div
        className="flex w-max gap-10 whitespace-nowrap"
        animate={
          reduce
            ? { x: 0 }
            : { x: ['0%', '-50%'] }
        }
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 60, repeat: Infinity, ease: 'linear' }
        }
        style={{ willChange: 'transform' }}
      >
        {[...ITEMS, ...ITEMS].map((item, idx) => (
          <span
            key={idx}
            className="flex shrink-0 items-center gap-10 font-semibold tracking-[-0.01em] text-on-background"
            style={{ fontSize: 'clamp(20px, 2.4vw, 32px)' }}
          >
            {item}
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full bg-accent-bright"
            />
          </span>
        ))}
      </motion.div>
    </section>
  );
}
