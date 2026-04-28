'use client';

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';
import { WalletButton } from '@/components/wallet/wallet-button';
import { ProposalsFeed } from '@/components/proposal-modal/proposals-feed';
import { HoldingsList } from '@/components/portfolio/holdings-list';
import { isDemo } from '@/lib/demo';

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '64px 24px',
        maxWidth: 1040,
        margin: '0 auto',
      }}
    >
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 64,
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          Hunch It<span style={{ color: 'var(--color-accent)' }}>.</span>
          {isDemo() && (
            <span
              className="badge"
              style={{ background: 'rgba(245,158,11,0.18)', color: 'var(--color-warn)' }}
            >
              DEMO
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link href="/portfolio" className="btn btn-ghost">
            Portfolio
          </Link>
          <Link href="/mandate" className="btn btn-ghost">
            Mandate
          </Link>
          <Link href="/settings" className="btn btn-ghost">
            Settings
          </Link>
          <WalletButton />
        </div>
      </nav>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ marginBottom: 48 }}
      >
        <h1
          style={{
            fontSize: 64,
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            marginBottom: 16,
          }}
        >
          AI trading signals for
          <br />
          <span style={{ color: 'var(--color-accent)' }}>tokenized US stocks.</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--color-fg-muted)', maxWidth: 640 }}>
          Set your mandate, then let the AI signal engine produce personalised BUY proposals on
          tokenized US stocks and bluechip crypto. One-tap places a Jupiter Trigger Order with
          auto TP / SL.
        </p>
      </motion.section>

      <motion.section
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
        }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}
      >
        <motion.div variants={cardVariants}>
          <Link
            href="/mandate"
            className="card"
            style={{ textDecoration: 'none', display: 'block' }}
          >
            <div style={{ color: 'var(--color-accent)', fontSize: 13, marginBottom: 8 }}>
              STEP 1 · DEFINE MANDATE
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
              Set your trading rules
            </div>
            <div style={{ color: 'var(--color-fg-muted)', fontSize: 14 }}>
              Holding period, drawdown tolerance, max trade size, sectors to watch.
            </div>
          </Link>
        </motion.div>
        <motion.div className="card" variants={cardVariants}>
          <div style={{ color: 'var(--color-fg-muted)', fontSize: 13, marginBottom: 8 }}>
            STEP 2 · AI WATCHES
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
            Personalised proposals
          </div>
          <div style={{ color: 'var(--color-fg-muted)', fontSize: 14 }}>
            Pyth + indicators + Claude → BUY proposals tailored to your mandate, with TP / SL.
          </div>
        </motion.div>
        <motion.div className="card" variants={cardVariants}>
          <div style={{ color: 'var(--color-fg-muted)', fontSize: 13, marginBottom: 8 }}>
            STEP 3 · ONE-TAP EXECUTE
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
            Trigger order + auto exits
          </div>
          <div style={{ color: 'var(--color-fg-muted)', fontSize: 14 }}>
            Approve once → Jupiter Trigger Order → auto TP / SL with OCO behaviour.
          </div>
        </motion.div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        style={{ marginTop: 48 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Holdings</h2>
          <Link href="/portfolio" style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
            Full portfolio →
          </Link>
        </div>
        <HoldingsList />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.25 }}
        style={{ marginTop: 32 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Proposals feed
          </h2>
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
            Sorted by urgency
          </span>
        </div>
        <ProposalsFeed limit={8} />
      </motion.section>
    </main>
  );
}
