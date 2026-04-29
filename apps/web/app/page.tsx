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
import { hasOnboarded } from '@/lib/onboarding/state';

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

const STEPS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: 'tune',
    title: 'Set your mandate',
    body: 'Tell the engine your holding period, drawdown tolerance, max trade size, and the markets you actually care about.',
  },
  {
    icon: 'campaign',
    title: 'Receive proposals',
    body: 'When momentum, volume, and macro line up, you get a single proposal — sized, priced, and reasoned against your mandate.',
  },
  {
    icon: 'shield',
    title: 'Execute with one tap',
    body: 'Approve and the BUY trigger places automatically. Take-profit and stop-loss go in alongside it, so the exit is set before you walk away.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { ready, connected, address } = useWallet();
  const mandateQuery = useMandate();

  // Routing rules for the marketing landing:
  //   - not logged in            → stay (show marketing copy + Login CTA)
  //   - logged in, mandate       → /desk (the real signed-in home)
  //   - logged in, no mandate,
  //     not onboarded yet        → /onboarding (4-step prep wizard)
  //   - logged in, no mandate,
  //     already onboarded        → /mandate (they backed out before saving)
  useEffect(() => {
    if (!ready || !connected) return;
    if (mandateQuery.isLoading) return;
    if (mandateQuery.data?.mandate) {
      router.replace('/desk');
      return;
    }
    router.replace(hasOnboarded(address) ? '/mandate' : '/onboarding');
  }, [ready, connected, address, mandateQuery.isLoading, mandateQuery.data, router]);

  return (
    <div className="min-h-screen bg-background text-on-background pb-32">
      <header className="px-5 pt-8 pb-4 flex justify-between items-center max-w-[1040px] mx-auto">
        <div className="text-title-lg font-bold flex items-center gap-2">
          Hunch It<span className="text-accent">.</span>
        </div>
        <div className="flex gap-3">
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
          <Button variant="accent" size="lg" className="w-full sm:w-auto shadow-soft" asChild>
            <Link href="/login">Get Started</Link>
          </Button>
        </motion.section>

        {/* How it works — replaces the mock portfolio block */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.15 }}
          className="mb-12"
        >
          <div className="flex justify-between items-baseline mb-4">
            <h2 className="text-title-lg font-bold">How it works</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {STEPS.map((s, i) => (
              <Card key={s.title} className="bg-surface shadow-micro">
                <CardContent className="p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-[22px]">{s.icon}</span>
                    </div>
                    <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                      Step {i + 1}
                    </span>
                  </div>
                  <h3 className="text-title-md text-primary">{s.title}</h3>
                  <p className="text-body-md text-on-surface-variant">{s.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.section>

        {/* Sample proposal — replaces the mock feed; clearly labelled. */}
        <motion.section
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.08, delayChildren: 0.22 } },
          }}
        >
          <div className="flex justify-between items-baseline mb-4">
            <h2 className="text-title-lg font-bold">A proposal looks like this</h2>
            <span className="text-label-sm text-on-surface-variant">Sample</span>
          </div>
          <motion.div variants={cardVariants}>
            <Card className="bg-accent border-transparent shadow-soft">
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <Badge className="bg-primary text-on-primary mb-2 border-transparent">SAMPLE</Badge>
                    <h3 className="text-title-lg font-bold text-on-accent">Long AAPL</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-primary shadow-micro">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                    </svg>
                  </div>
                </div>
                <p className="text-body-md text-on-accent/80 mb-6">
                  Earnings momentum breaking overhead resistance. Tech sector rotation confirms strength. Sized within mandate, exits prefilled.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface/40 p-3 rounded-xl">
                    <div className="text-label-sm opacity-70 mb-1 text-on-accent">Take profit</div>
                    <div className="font-bold text-on-accent">+8% target</div>
                  </div>
                  <div className="bg-surface/40 p-3 rounded-xl">
                    <div className="text-label-sm opacity-70 mb-1 text-on-accent">Stop loss</div>
                    <div className="font-bold text-on-accent">−5% guard</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
          <p className="mt-3 text-body-sm text-on-surface-variant text-center">
            Real proposals are tailored to your mandate and live market data once you sign in.
          </p>
        </motion.section>
      </main>
    </div>
  );
}
