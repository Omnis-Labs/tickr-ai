'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BARE_TICKERS, XSTOCKS, solscanTokenUrl } from '@hunch-it/shared';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo/flag';
import { unlockSound, playSignalSound } from '@/components/notifications/sound-manager';

type Step = 1 | 2 | 3 | 4;

/**
 * Four-step prep wizard run before /mandate. Wallet → notification
 * permission → sound unlock (browser blocks audio without a gesture) →
 * watchlist preview. Demo mode lets the user skip each gate so the cold
 * tour still works on a fresh device.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const { connected, login } = useWallet();
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
    <>
      <TopAppBar
        title="Get started"
        leftAction={
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-surface text-primary"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
        }
      />

      <main className="px-5 py-6 pb-24 max-w-md mx-auto">
        <div className="mb-4 flex items-center gap-1.5">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-surface-container'}`}
            />
          ))}
        </div>

        <div className="bg-surface rounded-lg p-5 shadow-soft">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-4"
            >
              {step === 1 && (
                <>
                  <Header step={1} title="Connect your wallet" />
                  <p className="text-body-md text-on-surface-variant">
                    Pick any Solana wallet. Your signature is required only to approve swaps — we never hold keys or funds.
                    {demo && (
                      <>
                        {' '}
                        <strong className="text-accent-bright">Demo mode — wallet is optional, you can skip.</strong>
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => login()}
                      className="h-11 px-5 rounded-full bg-primary text-on-primary text-label-lg active:scale-[0.97] transition-transform"
                    >
                      {connected ? 'Wallet connected' : 'Connect wallet'}
                    </button>
                  </div>
                  <Footer
                    onBack={null}
                    onNext={() => setStep(2)}
                    nextLabel={demo && !connected ? 'Skip' : 'Continue'}
                    nextDisabled={!connected && !demo}
                  />
                </>
              )}

              {step === 2 && (
                <>
                  <Header step={2} title="Allow notifications" />
                  <p className="text-body-md text-on-surface-variant">
                    Notifications fire when a signal lands and your tab is in the background. Click allow in your browser prompt.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={requestNotif}
                      className="h-11 px-5 rounded-full bg-primary text-on-primary text-label-lg active:scale-[0.97] transition-transform"
                    >
                      Request permission
                    </button>
                    <span className="text-body-sm text-on-surface-variant">
                      Status: <strong className="text-on-surface">{notifPermission}</strong>
                    </span>
                  </div>
                  <Footer
                    onBack={() => setStep(1)}
                    onNext={() => setStep(3)}
                    nextLabel={demo && notifPermission !== 'granted' ? 'Skip' : 'Continue'}
                    nextDisabled={notifPermission !== 'granted' && !demo}
                  />
                </>
              )}

              {step === 3 && (
                <>
                  <Header step={3} title="Unlock signal sound" />
                  <p className="text-body-md text-on-surface-variant">
                    Browsers block audio until a user gesture. Tap below so we can play a short cue when a signal lands — the same sound you'll hear in the wild.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleUnlockSound}
                      className="h-11 px-5 rounded-full bg-primary text-on-primary text-label-lg active:scale-[0.97] transition-transform"
                    >
                      {soundUnlocked ? 'Replay sound' : 'Unlock & test'}
                    </button>
                    {soundUnlocked && (
                      <span className="text-body-sm text-positive">✓ Unlocked</span>
                    )}
                  </div>
                  <Footer
                    onBack={() => setStep(2)}
                    onNext={() => setStep(4)}
                    nextLabel={demo && !soundUnlocked ? 'Skip' : 'Continue'}
                    nextDisabled={!soundUnlocked && !demo}
                  />
                </>
              )}

              {step === 4 && (
                <>
                  <Header step={4} title="What we monitor" />
                  <p className="text-body-md text-on-surface-variant">
                    Hunch It currently watches these {BARE_TICKERS.length} tokenized US stocks via Pyth + xStocks (SPL Token-2022). Click any address to inspect on Solscan.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {BARE_TICKERS.map((t) => {
                      const m = XSTOCKS[t];
                      const ready = m.mint.length > 0;
                      return (
                        <div
                          key={t}
                          className="bg-surface-container-low border border-outline-variant rounded-lg p-3"
                        >
                          <div className="flex justify-between items-baseline">
                            <strong className="text-label-md text-on-surface">{m.symbol}</strong>
                            <span className={`text-body-sm ${ready ? 'text-positive' : 'text-accent-bright'}`}>
                              {ready ? '✓' : 'pending'}
                            </span>
                          </div>
                          <div className="text-body-sm text-on-surface-variant mt-0.5 line-clamp-1">{m.name}</div>
                          {ready && (
                            <a
                              href={solscanTokenUrl(m.mint)}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-[11px] text-primary mt-1 break-all hover:underline"
                            >
                              {m.mint.slice(0, 8)}…{m.mint.slice(-6)}
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="flex-1 h-11 rounded-full border border-outline text-label-md text-primary active:scale-[0.97] transition-transform"
                    >
                      Back
                    </button>
                    <Link
                      href="/mandate"
                      className="flex-[2] h-11 inline-flex items-center justify-center rounded-full bg-accent text-on-accent text-label-lg shadow-soft active:scale-[0.97] transition-transform"
                    >
                      Set up mandate
                    </Link>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}

function Header({ step, title }: { step: number; title: string }) {
  return (
    <div>
      <div className="text-label-sm text-on-surface-variant uppercase tracking-wider">
        Step {step} of 4
      </div>
      <h1 className="text-title-lg text-primary mt-1">{title}</h1>
    </div>
  );
}

function Footer({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
}: {
  onBack: (() => void) | null;
  onNext: () => void;
  nextLabel: string;
  nextDisabled: boolean;
}) {
  return (
    <div className="flex gap-3 pt-2">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex-1 h-11 rounded-full border border-outline text-label-md text-primary active:scale-[0.97] transition-transform"
        >
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className={`${onBack ? 'flex-[2]' : 'flex-1'} h-11 rounded-full bg-primary text-on-primary text-label-lg active:scale-[0.97] transition-transform disabled:opacity-50 disabled:active:scale-100`}
      >
        {nextLabel}
      </button>
    </div>
  );
}
