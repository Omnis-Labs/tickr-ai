'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { HeroLight } from './hero-light';

export function LandingMarketing() {
  const router = useRouter();
  const { ready, connected } = useWallet();
  const authedFetch = useAuthedFetch();
  const reduce = useReducedMotion();

  // Cookie-less-but-Privy-authed fallback: server SessionGate already
  // redirected any user with a verifiable privy-token cookie. If we got
  // here despite Privy reporting authed, ask /api/me/state (never 401s,
  // returns SIGNED_OUT for missing/invalid token) and push once. We
  // don't call /api/mandates here because a 401 from any other /api/*
  // trips useAuthedFetch's global session-expiry redirect into /login
  // and breaks the public landing for genuinely-signed-out visitors.
  useEffect(() => {
    if (!ready || !connected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/me/state');
        if (!res.ok) return;
        const state = (await res.json()) as { nextPath: string | null };
        if (cancelled) return;
        if (state.nextPath && state.nextPath !== '/login') {
          router.replace(state.nextPath);
        }
      } catch {
        /* landing renders; user can click Sign in manually */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, connected, authedFetch, router]);

  return (
    <div className="min-h-screen bg-background text-on-background">
      <header className="relative z-10 mx-auto flex max-w-[1200px] items-center justify-between px-6 pt-7 sm:px-10">
        <Link href="/" className="text-title-md font-semibold tracking-tight">
          Hunch It<span className="text-on-surface-variant">.</span>
        </Link>
        <Link
          href="/login"
          className="text-label-lg text-on-surface-variant transition-colors hover:text-on-background"
        >
          Sign in
        </Link>
      </header>

      <section className="relative isolate mx-auto flex min-h-[88vh] max-w-[1200px] flex-col justify-center px-6 pb-32 pt-20 sm:px-10 sm:pt-28">
        <HeroLight />

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="font-semibold tracking-[-0.04em] text-on-background"
          style={{
            fontSize: 'clamp(56px, 13vw, 168px)',
            lineHeight: 0.92,
          }}
          aria-label="Trust your hunch."
        >
          Trust your hunch
          <motion.span
            aria-hidden
            className="ml-[0.04em] inline-block rounded-full bg-accent align-baseline"
            style={{
              width: '0.42em',
              height: '0.42em',
              marginBottom: '0.02em',
            }}
            animate={
              reduce
                ? { scale: 1, opacity: 1 }
                : { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }
            }
            transition={
              reduce
                ? { duration: 0 }
                : {
                    duration: 5.8,
                    repeat: Infinity,
                    ease: [0.22, 1, 0.36, 1],
                  }
            }
          />
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
          className="mt-10 max-w-[58ch] text-body-lg text-on-surface-variant sm:text-[18px] sm:leading-[1.55]"
        >
          An AI quant analyst proposes trades sized to your mandate, with
          take-profit and stop-loss pre-armed. Tap once to execute. Trade on
          your terms.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.22 }}
          className="mt-10 flex items-center gap-5"
        >
          <Button variant="accent" size="lg" asChild>
            <Link href="/login">Get started</Link>
          </Button>
          <Link
            href="#mechanic"
            className="text-label-lg text-on-surface-variant transition-colors hover:text-on-background"
          >
            See how it works
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
