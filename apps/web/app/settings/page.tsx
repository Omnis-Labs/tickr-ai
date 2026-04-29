'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  HOLDING_PERIOD_OPTIONS,
  MARKET_FOCUS_VERTICALS,
  MAX_DRAWDOWN_OPTIONS,
  XSTOCKS,
  xStockToBare,
  type XStockTicker,
} from '@hunch-it/shared';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import { useRuntime } from '@/lib/runtime/use-runtime';
import { useMandate, usePortfolio } from '@/lib/hooks/queries';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function SettingsPage() {
  const demo = isDemo();
  const { address, connected, logout } = useWallet();
  const wallet = demo ? 'demo-wallet' : address;

  const mandateQuery = useMandate();
  const portfolioQuery = usePortfolio();

  const mandate = mandateQuery.data?.mandate;
  const isLoading = mandateQuery.isLoading;

  const verticalLabels = (mandate?.marketFocus ?? []).map(
    (id) => MARKET_FOCUS_VERTICALS.find((v) => v.id === id)?.label ?? id,
  );

  const positionsCount = useMemo(
    () => (portfolioQuery.data?.positions ?? []).filter((p) => p.tokenAmount > 0).length,
    [portfolioQuery.data?.positions],
  );
  const positionsValue = useMemo(() => {
    const positions = portfolioQuery.data?.positions ?? [];
    return positions.reduce((acc, p) => acc + p.tokenAmount * (p.markPrice ?? p.avgCost), 0);
  }, [portfolioQuery.data?.positions]);

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <TopAppBar title="Settings" />

      <main className="px-5 py-6 pb-24 max-w-md mx-auto flex flex-col gap-6">
        <Section icon="person" title="Account">
          {!connected && !demo ? (
            <p className="text-body-md text-on-surface-variant">Not signed in.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <Row label="Mode">{demo ? 'Demo' : 'Live'}</Row>
              <div className="flex flex-col gap-1">
                <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">Wallet</span>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-body-md text-on-surface truncate">
                    {address ? shorten(address) : 'demo-wallet'}
                  </span>
                  {address && (
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label="Copy wallet address"
                      className="w-9 h-9 rounded-full bg-surface-container-low text-primary flex items-center justify-center active:scale-[0.95] transition-transform"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {copied ? 'check' : 'content_copy'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
              {!demo && connected && (
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="self-start flex items-center gap-2 text-label-md text-negative hover:underline"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span>
                  Sign out
                </button>
              )}
            </div>
          )}
        </Section>

        <Section icon="briefcase" title="Positions Overview">
          <Row label="Active positions">
            <span className="tabular-nums">{positionsCount}</span>
          </Row>
          <div className="h-px bg-divider my-3" />
          <Row label="Total value">
            <span className="text-primary tabular-nums">
              ${positionsValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </Row>
        </Section>

        <Section
          icon="tune"
          title="Your Mandate"
          right={
            mandate ? (
              <Link
                href="/mandate"
                className="text-label-md text-primary hover:underline"
              >
                Edit
              </Link>
            ) : null
          }
        >
          {isLoading ? (
            <p className="text-body-md text-on-surface-variant">Loading…</p>
          ) : !mandate ? (
            <div>
              <p className="text-body-md text-on-surface-variant mb-3">
                No mandate yet. Without a mandate the signal engine doesn't generate proposals.
              </p>
              <Link
                href="/mandate"
                className="inline-flex items-center justify-center bg-primary text-on-primary rounded-full h-11 px-5 text-label-lg active:scale-[0.97] transition-transform"
              >
                Set up mandate
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Row label="Holding period">
                {HOLDING_PERIOD_OPTIONS.find((o) => o.value === mandate.holdingPeriod)?.label ??
                  mandate.holdingPeriod}
              </Row>
              <Row label="Max drawdown">
                {MAX_DRAWDOWN_OPTIONS.find((o) => o.value === mandate.maxDrawdown)?.label ?? 'Custom'}
              </Row>
              <Row label="Max trade size">
                <span className="tabular-nums">${mandate.maxTradeSize.toFixed(2)}</span>
              </Row>
              <div className="flex flex-col gap-2">
                <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">Market focus</span>
                <div className="flex flex-wrap gap-2">
                  {verticalLabels.length === 0 && <span className="text-body-sm text-on-surface-variant">—</span>}
                  {verticalLabels.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface-container-low text-label-sm text-primary"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-body-sm text-on-surface-variant pt-3 mt-1 border-t border-divider">
                Editing the mandate marks every active proposal as expired and the engine regenerates against the new parameters on its next cycle.
              </p>
            </div>
          )}
        </Section>

        <DelegationCard wallet={wallet ?? null} />
        <CloseAllPositionsCard />
      </main>
    </>
  );
}

/**
 * Phase F — Delegated signing toggle. Keeping the localStorage mirror so
 * the toggle restores between sessions even though we never built a
 * /api/users GET to read delegationActive back from the DB.
 */
function DelegationCard({ wallet }: { wallet: string | null }) {
  const demo = isDemo();
  const [active, setActive] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const authedFetch = useAuthedFetch();
  const { delegateSolanaWallet, revokeDelegations } = useWallet();

  useEffect(() => {
    if (!wallet || demo) return;
    if (typeof window === 'undefined') return;
    const cached = window.localStorage.getItem(`delegation:${wallet}`);
    if (cached === '1') setActive(true);
  }, [wallet, demo]);

  async function toggle(next: boolean) {
    if (!wallet) {
      toast.error('Connect a wallet first.');
      return;
    }
    setBusy(true);
    try {
      if (!demo) {
        try {
          if (next) await delegateSolanaWallet();
          else await revokeDelegations();
        } catch (err) {
          console.warn('[delegation] grant/revoke failed', err);
          toast.error(
            `Privy delegation ${next ? 'grant' : 'revoke'} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const res = await authedFetch('/api/users/delegation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet, delegationActive: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `${res.status}`);
      }
      setActive(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`delegation:${wallet}`, next ? '1' : '0');
      }
      toast.success(next ? 'Auto-exit signing enabled.' : 'Auto-exit signing disabled.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon="bolt" title="Auto-exit signing">
      <p className="text-body-sm text-on-surface-variant mb-3">
        Allow the Hunch server to cancel a paired exit order automatically when its sibling fills (OCO behaviour), and to place TP / SL after a BUY fills, without prompting you to sign each time.
      </p>
      <ul className="text-body-sm text-on-surface-variant list-disc pl-5 mb-4 space-y-1">
        <li>Scope is constrained to Jupiter trigger orders for positions you opened.</li>
        <li>You can revoke it any time below.</li>
        <li>Every server-signed transaction is recorded against your account.</li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void toggle(!active)}
          disabled={busy}
          className={`flex items-center justify-center h-11 px-5 rounded-full text-label-lg transition-transform active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${
            active ? 'bg-accent text-on-accent shadow-soft' : 'bg-primary text-on-primary'
          }`}
        >
          {busy ? 'Saving…' : active ? 'Disable auto-exit' : 'Enable auto-exit'}
        </button>
        <span className={`text-label-md ${active ? 'text-positive' : 'text-on-surface-variant'}`}>
          {active ? '✓ Auto-exit active' : 'Manual confirmation required'}
        </span>
      </div>
    </Section>
  );
}

/**
 * Manual "panic close". Each live position needs at least one wallet sig
 * (cancel) plus one swap sig — sequential by design so Privy modals don't
 * stack.
 */
function CloseAllPositionsCard() {
  const demo = isDemo();
  const router = useRouter();
  const positions = useDemoPositionsStore((s) => s.positions);
  const closeDemoPosition = useDemoPositionsStore((s) => s.closePosition);
  const runtime = useRuntime();
  const authedFetch = useAuthedFetch();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const openCount = demo ? positions.filter((p) => p.state !== 'CLOSED').length : null;

  async function closeOne(p: {
    id: string;
    ticker: string;
    tokenAmount: number;
    markPrice: number;
  }): Promise<void> {
    const meta = XSTOCKS[xStockToBare(p.ticker as XStockTicker)];
    if (!meta?.mint) throw new Error(`${p.ticker} mint not configured`);
    await runtime.closePosition({
      positionId: p.id,
      meta: { mint: meta.mint, decimals: meta.decimals },
      fallbackMarkPrice: p.markPrice,
    });
    if (demo) closeDemoPosition(p.id, 'USER_CLOSE', p.markPrice);
  }

  async function handleCloseAll() {
    setBusy(true);
    try {
      let targets: Array<{ id: string; ticker: string; tokenAmount: number; markPrice: number }>;
      if (demo) {
        targets = positions
          .filter((p) => p.state !== 'CLOSED')
          .map((p) => ({
            id: p.id,
            ticker: p.ticker,
            tokenAmount: p.tokenAmount,
            markPrice: p.markPrice,
          }));
      } else {
        const r = await authedFetch('/api/positions');
        const j = (await r.json().catch(() => ({ positions: [] }))) as {
          positions: Array<{ id: string; ticker: string; tokenAmount: number; entryPrice: number }>;
        };
        targets = (j.positions ?? []).map((p) => ({
          id: p.id,
          ticker: p.ticker,
          tokenAmount: p.tokenAmount,
          markPrice: p.entryPrice,
        }));
      }

      if (targets.length === 0) {
        toast('No open positions.');
        setConfirm(false);
        return;
      }

      setProgress({ done: 0, total: targets.length });
      for (let i = 0; i < targets.length; i++) {
        try {
          await closeOne(targets[i]!);
        } catch (err) {
          toast.error(
            `Close ${targets[i]!.ticker} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        setProgress({ done: i + 1, total: targets.length });
      }
      toast.success(`Closed ${targets.length} position${targets.length === 1 ? '' : 's'}.`);
      router.replace('/');
    } finally {
      setBusy(false);
      setProgress(null);
      setConfirm(false);
    }
  }

  return (
    <Section icon="warning" title="Panic close">
      <p className="text-body-sm text-on-surface-variant mb-3">
        Cancel every open TP / SL trigger order and market-sell every position you currently hold. Each position needs one wallet signature (cancel) plus one swap signature in live mode.
        {demo && openCount != null && (
          <>
            {' '}Demo store has <strong>{openCount}</strong> open position{openCount === 1 ? '' : 's'}.
          </>
        )}
      </p>
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={busy}
          className="flex items-center justify-center h-11 px-5 rounded-full bg-negative text-on-negative text-label-lg active:scale-[0.97] transition-transform disabled:opacity-50"
        >
          Close all positions
        </button>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setConfirm(false)}
            disabled={busy}
            className="flex-1 h-11 rounded-full border border-outline text-label-lg text-primary active:scale-[0.97] transition-transform disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCloseAll()}
            disabled={busy}
            className="flex-[2] h-11 rounded-full bg-negative text-on-negative text-label-lg active:scale-[0.97] transition-transform disabled:opacity-50"
          >
            {busy
              ? progress
                ? `Closing ${progress.done}/${progress.total}…`
                : 'Closing…'
              : 'Confirm close all'}
          </button>
        </div>
      )}
    </Section>
  );
}

function Section({
  icon,
  title,
  right,
  children,
}: {
  icon: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-surface rounded-lg p-5 shadow-soft"
    >
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-icon-muted text-[20px]">{icon}</span>
          <h2 className="text-title-md text-primary">{title}</h2>
        </div>
        {right}
      </header>
      {children}
    </motion.section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span className="text-body-md text-on-surface text-right">{children}</span>
    </div>
  );
}
