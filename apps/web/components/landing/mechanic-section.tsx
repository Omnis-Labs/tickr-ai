'use client';

import {
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from 'framer-motion';
import { useRef } from 'react';

const STEPS = [
  {
    n: '01',
    title: 'Set your mandate.',
    body: 'Tell the engine your holding period, drawdown tolerance, max trade size, and the markets you actually care about. Every proposal is sized to these constraints, never around them.',
    mock: 'mandate',
  },
  {
    n: '02',
    title: 'Receive a proposal.',
    body: 'When momentum, volume, and macro line up, you get a single proposal sized to your mandate, priced against the tape, and reasoned in plain language. Not a chart wall, one trade.',
    mock: 'proposal',
  },
  {
    n: '03',
    title: 'Tap to execute.',
    body: 'Approve and the BUY trigger places automatically. Take-profit and stop-loss arm in the same step, so the exit is set before you walk away. One cancels the other when the trade resolves.',
    mock: 'execute',
  },
] as const;

const easeOutQuart = [0.25, 1, 0.5, 1] as const;

export function MechanicSection() {
  return (
    <section
      id="mechanic"
      className="mx-auto max-w-[1200px] px-6 pb-32 pt-16 sm:px-10 sm:pt-24"
    >
      <div className="mb-20 flex items-baseline gap-3">
        <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
          01
        </span>
        <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
          /
        </span>
        <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
          The mechanic
        </span>
      </div>

      <div className="space-y-28 sm:space-y-36">
        {STEPS.map((step, i) => (
          <Step key={step.n} step={step} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}

function Step({
  step,
  flip,
}: {
  step: (typeof STEPS)[number];
  flip: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  return (
    <div
      ref={ref}
      className={`grid items-center gap-10 sm:grid-cols-[1fr_1fr] sm:gap-16 ${
        flip ? 'sm:[&>*:first-child]:order-2' : ''
      }`}
    >
      <div>
        <div className="mb-5 flex items-baseline gap-3">
          <span className="font-mono text-display-lg font-medium text-accent-bright sm:text-[64px] sm:leading-none">
            {step.n}
          </span>
        </div>
        <h3
          className="mb-5 font-semibold tracking-[-0.02em] text-on-background"
          style={{
            fontSize: 'clamp(28px, 4.4vw, 48px)',
            lineHeight: 1.05,
          }}
        >
          {step.title}
        </h3>
        <p className="max-w-[44ch] text-body-lg text-on-surface-variant sm:text-[17px] sm:leading-[1.55]">
          {step.body}
        </p>
      </div>

      <div className="relative flex items-center justify-center">
        {step.mock === 'mandate' && <MandateMock active={inView} />}
        {step.mock === 'proposal' && <ProposalMock active={inView} />}
        {step.mock === 'execute' && <ExecuteMock active={inView} />}
      </div>
    </div>
  );
}

function MandateMock({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const items: Array<{ label: string; value: string; fill: number }> = [
    { label: 'Holding period', value: '2 to 8 weeks', fill: 0.55 },
    { label: 'Max drawdown', value: '15%', fill: 0.15 },
    { label: 'Max trade size', value: '5% of book', fill: 0.05 },
  ];

  const containerVariants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.18, delayChildren: 0.1 } },
  };
  const rowVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOutQuart } },
  };
  const trackFill: Variants = {
    hidden: { scaleX: 0 },
    show: {
      scaleX: 1,
      transition: { duration: 1.1, ease: easeOutQuart, delay: 0.15 },
    },
  };

  return (
    <motion.div
      initial="hidden"
      animate={active ? 'show' : 'hidden'}
      variants={containerVariants}
      className="w-full max-w-[420px] rounded-[24px] bg-surface p-7 shadow-soft"
      style={{ originX: 0 }}
    >
      <div className="mb-6 flex items-center justify-between">
        <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
          Mandate
        </span>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-label-sm text-on-accent">
          ACTIVE
        </span>
      </div>

      <div className="space-y-5">
        {items.map((it) => (
          <motion.div key={it.label} variants={rowVariants}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-body-md text-on-surface-variant">
                {it.label}
              </span>
              <span className="font-mono text-label-lg text-on-background">
                {it.value}
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-accent-bright"
                style={{ width: `${it.fill * 100}%`, originX: 0 }}
                variants={reduce ? undefined : trackFill}
              />
            </div>
          </motion.div>
        ))}

        <motion.div variants={rowVariants}>
          <div className="mb-2 text-body-md text-on-surface-variant">
            Markets
          </div>
          <div className="flex flex-wrap gap-2">
            {['US tech', 'Tokenized ETFs', 'Bluechip crypto'].map((m) => (
              <span
                key={m}
                className="rounded-full bg-surface-container px-3 py-1 text-label-md text-on-background"
              >
                {m}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function ProposalMock({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const fade: Variants = {
    hidden: { opacity: 0, y: 6 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.55, ease: easeOutQuart, delay: 0.1 + i * 0.18 },
    }),
  };

  return (
    <motion.div
      initial="hidden"
      animate={active ? 'show' : 'hidden'}
      className="w-full max-w-[420px] rounded-[24px] bg-accent p-7 text-on-accent shadow-soft"
    >
      <motion.div variants={fade} custom={0} className="mb-4 flex items-center justify-between">
        <span className="font-mono text-label-sm uppercase tracking-[0.18em]">
          Proposal
        </span>
        <span className="rounded-full bg-on-accent/10 px-2.5 py-0.5 font-mono text-label-sm">
          BUY · NVDAx
        </span>
      </motion.div>

      <motion.div variants={fade} custom={1} className="mb-6">
        <div className="mb-1 font-mono text-[44px] font-semibold leading-none tracking-[-0.03em]">
          2.4<span className="text-[28px] opacity-60">%</span>
        </div>
        <div className="text-body-md opacity-70">of book sized to mandate</div>
      </motion.div>

      <motion.svg
        variants={fade}
        custom={2}
        viewBox="0 0 320 80"
        className="mb-6 h-[80px] w-full"
        aria-hidden
      >
        <motion.path
          d="M 0 60 C 40 55, 80 48, 120 38 S 200 22, 260 18 320 12 320 12"
          stroke="currentColor"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={active ? { pathLength: 1 } : { pathLength: 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 1.4, ease: easeOutQuart, delay: 0.55 }
          }
        />
        <line
          x1="0"
          y1="22"
          x2="320"
          y2="22"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 4"
          opacity={0.5}
        />
      </motion.svg>

      <motion.div variants={fade} custom={3} className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-on-accent/10 p-3.5">
          <div className="mb-0.5 font-mono text-label-sm uppercase tracking-wider opacity-70">
            Take profit
          </div>
          <div className="font-mono text-title-lg">+8%</div>
        </div>
        <div className="rounded-2xl bg-on-accent/10 p-3.5">
          <div className="mb-0.5 font-mono text-label-sm uppercase tracking-wider opacity-70">
            Stop loss
          </div>
          <div className="font-mono text-title-lg">−5%</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ExecuteMock({ active }: { active: boolean }) {
  const reduce = useReducedMotion();

  return (
    <div className="relative w-full max-w-[420px]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        transition={{ duration: 0.55, ease: easeOutQuart }}
        className="rounded-[24px] bg-surface p-7 shadow-soft"
      >
        <div className="mb-5 flex items-center justify-between">
          <span className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
            Position open
          </span>
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-label-sm text-on-accent">
            ACTIVE
          </span>
        </div>

        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-mono text-[40px] font-semibold leading-none tracking-[-0.03em] text-on-background">
            NVDAx
          </span>
          <span className="font-mono text-label-lg text-on-surface-variant">
            $187.20
          </span>
        </div>
        <div className="mb-6 text-body-md text-on-surface-variant">
          Filled at trigger, 2.4% of book.
        </div>

        <div className="space-y-2">
          <ArmedRow label="Take-profit armed" value="+8% target" />
          <ArmedRow label="Stop-loss armed" value="−5% guard" />
        </div>
      </motion.div>

      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-4 right-8 h-16 w-16 rounded-full bg-accent"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={
          active
            ? reduce
              ? { scale: 1, opacity: 0 }
              : { scale: [0.4, 1.6, 1.6], opacity: [0, 0.55, 0] }
            : { scale: 0.4, opacity: 0 }
        }
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 1.4, ease: easeOutQuart, delay: 0.7 }
        }
        style={{ filter: 'blur(8px)' }}
      />
    </div>
  );
}

function ArmedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface-container px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-positive" />
        <span className="text-body-md text-on-background">{label}</span>
      </div>
      <span className="font-mono text-label-lg text-on-surface-variant">
        {value}
      </span>
    </div>
  );
}
