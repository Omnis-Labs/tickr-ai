'use client';

import { useWallet } from '@/lib/wallet/use-wallet';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useState } from 'react';
import { BARE_TICKERS, XSTOCKS, solscanTokenUrl } from '@hunch-it/shared';
import { WalletButton } from '@/components/wallet/wallet-button';
import { unlockSound, playSignalSound } from '@/components/notifications/sound-manager';
import { isDemo } from '@/lib/demo/flag';

type Step = 1 | 2 | 3 | 4;

function StepHeader({ step, total, title }: { step: Step; total: number; title: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ color: 'var(--color-fg-muted)', fontSize: 13, marginBottom: 4 }}>
        STEP {step} OF {total}
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</h1>
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>(1);
  const { connected } = useWallet();
  const demo = isDemo();
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const [soundUnlocked, setSoundUnlocked] = useState(false);

  async function requestNotif() {
    if (typeof Notification === 'undefined') {
      setNotifPermission('unsupported');
      return;
    }
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  function handleUnlockSound() {
    unlockSound();
    setSoundUnlocked(true);
    void playSignalSound(0.3);
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        maxWidth: 560,
        margin: '0 auto',
        padding: '48px 24px',
      }}
    >
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>

      <div style={{ marginTop: 24 }} className="card">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
          >
        {step === 1 && (
          <>
            <StepHeader step={1} total={4} title="Connect your wallet" />
            <p style={{ color: 'var(--color-fg-muted)', marginBottom: 16 }}>
              Pick any Solana wallet. Your signature is required only to approve swaps — we never
              hold keys or funds.
              {demo && (
                <>
                  {' '}
                  <strong style={{ color: 'var(--color-warn)' }}>
                    Demo mode — wallet is optional, you can skip.
                  </strong>
                </>
              )}
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <WalletButton />
              <button
                className="btn btn-primary"
                disabled={!connected && !demo}
                onClick={() => setStep(2)}
              >
                {demo && !connected ? 'Skip →' : 'Continue →'}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <StepHeader step={2} total={4} title="Allow notifications" />
            <p style={{ color: 'var(--color-fg-muted)', marginBottom: 16 }}>
              Notifications fire when a signal lands and your tab is in the background. Click
              allow in your browser prompt.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={requestNotif}>
                Request permission
              </button>
              <div style={{ fontSize: 14, color: 'var(--color-fg-muted)' }}>
                Status: <strong>{notifPermission}</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                disabled={notifPermission !== 'granted' && !demo}
                onClick={() => setStep(3)}
              >
                {demo && notifPermission !== 'granted' ? 'Skip →' : 'Continue →'}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <StepHeader step={3} total={4} title="Unlock signal sound" />
            <p style={{ color: 'var(--color-fg-muted)', marginBottom: 16 }}>
              Browsers block audio until a user gesture. Tap below so we can play a short cue when
              a signal lands — the same sound you'll hear in the wild.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={handleUnlockSound}>
                {soundUnlocked ? 'Replay sound' : 'Unlock & test'}
              </button>
              {soundUnlocked && (
                <span style={{ fontSize: 13, color: 'var(--color-buy)' }}>✓ Unlocked</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setStep(2)}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                disabled={!soundUnlocked && !demo}
                onClick={() => setStep(4)}
              >
                {demo && !soundUnlocked ? 'Skip →' : 'Continue →'}
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <StepHeader step={4} total={4} title="What we monitor" />
            <p style={{ color: 'var(--color-fg-muted)', marginBottom: 16 }}>
              Hunch It currently watches these 8 tokenized US stocks via Pyth + xStocks (SPL
              Token-2022). Click any address to inspect on Solscan.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                marginBottom: 24,
              }}
            >
              {BARE_TICKERS.map((t) => {
                const m = XSTOCKS[t];
                const ready = m.mint.length > 0;
                return (
                  <div
                    key={t}
                    style={{
                      background: 'var(--color-bg-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{m.symbol}</strong>
                      <span style={{ color: ready ? 'var(--color-buy)' : 'var(--color-warn)' }}>
                        {ready ? '✓' : 'pending'}
                      </span>
                    </div>
                    <div style={{ color: 'var(--color-fg-muted)', marginTop: 2 }}>{m.name}</div>
                    {ready && (
                      <a
                        href={solscanTokenUrl(m.mint)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: 'var(--color-accent)',
                          fontSize: 11,
                          marginTop: 4,
                          display: 'block',
                          wordBreak: 'break-all',
                        }}
                      >
                        {m.mint}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setStep(3)}>
                ← Back
              </button>
              <Link href="/mandate" className="btn btn-primary">
                Set up mandate →
              </Link>
            </div>
          </>
        )}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}
