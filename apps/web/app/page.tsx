'use client';

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useMandate } from '@/lib/hooks/queries';

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

export default function LandingPage() {
  const router = useRouter();
  const { ready, connected } = useWallet();
  const mandateQuery = useMandate();

  // Routing rules for the marketing landing:
  //   - not logged in        → stay (show marketing copy + Login CTA)
  //   - logged in, mandate?  → /desk (the real signed-in home)
  //   - logged in, no mandate→ /mandate (one-time setup)
  // The mandate query is enabled by default; in DEMO_MODE it returns
  // DEMO_MANDATE so the redirect to /desk fires immediately.
  useEffect(() => {
    if (!ready || !connected) return;
    if (mandateQuery.isLoading) return;
    if (mandateQuery.data?.mandate) router.replace('/desk');
    else router.replace('/mandate');
  }, [ready, connected, mandateQuery.isLoading, mandateQuery.data, router]);

  return (
    <div className="min-h-screen bg-background text-on-background pb-32">
      <header className="px-5 pt-8 pb-4 flex justify-between items-center max-w-[1040px] mx-auto">
        <div className="text-title-lg font-bold flex items-center gap-2">
          Hunch It<span className="text-accent">.</span>
        </div>
        <div className="flex gap-3">
          {/* // TODO(integration): Wire auth login trigger */}
          <Button variant="outline" size="sm" asChild>
            <Link href="/login">Login</Link>
          </Button>
        </div>
      </header>

      <main className="px-5 max-w-[1040px] mx-auto">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32 }}
          className="py-12"
        >
          <h1 className="text-display-lg sm:text-[56px] sm:leading-[60px] font-bold tracking-tight mb-6 max-w-2xl">
            Market moves.<br />
            Clear signals.<br />
            <span className="text-accent-bright bg-primary px-2 rounded-lg inline-block mt-2">One tap.</span>
          </h1>
          <p className="text-body-lg text-on-surface-variant max-w-xl mb-8">
            AI-driven trading signals for tokenized US stocks on Solana. We translate market data into clear proposals, you execute in seconds. Every position is protected.
          </p>
          {/* // TODO(integration): Wire auth login trigger */}
          <Button variant="accent" size="lg" className="w-full sm:w-auto shadow-soft" asChild>
            <Link href="/login">Get Started</Link>
          </Button>
        </motion.section>

        {/* Mock Portfolio Summary */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.15 }}
          className="mb-12"
        >
          <div className="flex justify-between items-baseline mb-4">
            <h2 className="text-title-lg font-bold">Portfolio</h2>
            <Link href="/portfolio" className="text-label-md text-on-surface-variant">
              View all →
            </Link>
          </div>
          {/* // TODO(integration): Wire to GET /api/portfolio for live data */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-surface shadow-micro">
              <CardContent className="p-5">
                <div className="text-label-sm text-on-surface-variant mb-1">Total Value</div>
                <div className="text-number-md tracking-tight">$12,450.00</div>
              </CardContent>
            </Card>
            <Card className="bg-surface shadow-micro">
              <CardContent className="p-5">
                <div className="text-label-sm text-on-surface-variant mb-1">24h Change</div>
                <div className="text-number-md tracking-tight text-positive flex items-center gap-1">
                  +$342.50
                </div>
                <Badge variant="positive" className="mt-2">
                  +2.8%
                </Badge>
              </CardContent>
            </Card>
          </div>
        </motion.section>

        {/* Mock Proposals Feed */}
        <motion.section
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.08, delayChildren: 0.22 } },
          }}
        >
          <div className="flex justify-between items-baseline mb-4">
            <h2 className="text-title-lg font-bold">Proposals feed</h2>
            <span className="text-label-sm text-on-surface-variant">
              Sorted by urgency
            </span>
          </div>
          {/* // TODO(integration): Wire to GET /api/proposals for live feed */}
          <div className="space-y-4">
            {/* Mock Proposal 1 */}
            <motion.div variants={cardVariants}>
              <Card className="bg-accent border-transparent shadow-soft">
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <Badge className="bg-primary text-on-primary mb-2 border-transparent">NEW PROPOSAL</Badge>
                      <h3 className="text-title-lg font-bold text-on-accent">Long AAPL</h3>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-primary shadow-micro">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                      </svg>
                    </div>
                  </div>
                  <p className="text-body-md text-on-accent/80 mb-6">
                    Earnings momentum breaking overhead resistance. Tech sector rotation confirms strength.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface/40 p-3 rounded-xl">
                      <div className="text-label-sm opacity-70 mb-1 text-on-accent">Target</div>
                      <div className="font-bold text-on-accent">$192.50</div>
                    </div>
                    <div className="bg-surface/40 p-3 rounded-xl">
                      <div className="text-label-sm opacity-70 mb-1 text-on-accent">Stop Loss</div>
                      <div className="font-bold text-on-accent">$178.00</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Mock Proposal 2 */}
            <motion.div variants={cardVariants}>
              <Card className="shadow-micro">
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <Badge variant="secondary" className="mb-2">ACTIVE</Badge>
                      <h3 className="text-title-lg font-bold">Long TSLA</h3>
                    </div>
                    <span className="text-label-sm text-on-surface-variant">2h ago</span>
                  </div>
                  <p className="text-body-md text-on-surface-variant mb-6">
                    Volatility contraction pattern resolving upwards. High confidence setup.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-container p-3 rounded-xl">
                      <div className="text-label-sm text-on-surface-variant mb-1">Target</div>
                      <div className="font-bold text-on-surface">$210.00</div>
                    </div>
                    <div className="bg-surface-container p-3 rounded-xl">
                      <div className="text-label-sm text-on-surface-variant mb-1">Stop Loss</div>
                      <div className="font-bold text-on-surface">$165.50</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
