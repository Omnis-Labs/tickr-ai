'use client';

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WalletButton } from '@/components/wallet/wallet-button';
import { ProposalsFeed } from '@/components/proposal-modal/proposals-feed';
import { HoldingsList } from '@/components/portfolio/holdings-list';
import { isDemo } from '@/lib/demo';

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

export default function LandingPage() {
  const demo = isDemo();

  return (
    <main className="mx-auto max-w-[1040px] min-h-screen px-6 py-16">
      <nav className="mb-16 flex items-center justify-between">
        <div className="flex items-baseline gap-3 text-xl font-bold tracking-tight">
          <span>
            Hunch It<span className="text-accent">.</span>
          </span>
          {demo && (
            <Badge variant="outline" className="border-positive text-positive">
              DEMO
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/portfolio">Portfolio</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/mandate">Mandate</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings">Settings</Link>
          </Button>
          <WalletButton />
        </div>
      </nav>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-12"
      >
        <h1 className="mb-4 text-[64px] font-extrabold leading-[1.05] tracking-[-0.03em]">
          AI trading signals for
          <br />
          <span className="text-accent">tokenized US stocks.</span>
        </h1>
        <p className="max-w-[640px] text-lg text-on-surface-variant">
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
        className="grid grid-cols-3 gap-4"
      >
        <motion.div variants={cardVariants}>
          <Link href="/mandate" className="block">
            <Card className="h-full transition-transform hover:scale-[1.01]">
              <CardContent className="p-5">
                <div className="mb-2 text-xs uppercase tracking-wider text-accent">
                  STEP 1 · DEFINE MANDATE
                </div>
                <div className="mb-1 text-lg font-semibold">Set your trading rules</div>
                <div className="text-sm text-on-surface-variant">
                  Holding period, drawdown tolerance, max trade size, sectors to watch.
                </div>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
        <motion.div variants={cardVariants}>
          <Card className="h-full">
            <CardContent className="p-5">
              <div className="mb-2 text-xs uppercase tracking-wider text-on-surface-variant">
                STEP 2 · AI WATCHES
              </div>
              <div className="mb-1 text-lg font-semibold">Personalised proposals</div>
              <div className="text-sm text-on-surface-variant">
                Pyth + indicators + Claude → BUY proposals tailored to your mandate, with TP / SL.
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={cardVariants}>
          <Card className="h-full">
            <CardContent className="p-5">
              <div className="mb-2 text-xs uppercase tracking-wider text-on-surface-variant">
                STEP 3 · ONE-TAP EXECUTE
              </div>
              <div className="mb-1 text-lg font-semibold">Trigger order + auto exits</div>
              <div className="text-sm text-on-surface-variant">
                Approve once → Jupiter Trigger Order → auto TP / SL with OCO behaviour.
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        className="mt-12"
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Holdings</h2>
          <Link href="/portfolio" className="text-sm text-on-surface-variant hover:text-on-surface">
            Full portfolio →
          </Link>
        </div>
        <HoldingsList />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.25 }}
        className="mt-8"
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Proposals feed</h2>
          <span className="text-sm text-on-surface-variant">Sorted by urgency</span>
        </div>
        <ProposalsFeed limit={8} />
      </motion.section>
    </main>
  );
}
