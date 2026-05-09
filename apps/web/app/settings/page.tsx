'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  BriefcaseBusiness,
  Check,
  Clipboard,
  LogOut,
  Pencil,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  Zap,
} from 'lucide-react';
import {
  HOLDING_PERIOD_OPTIONS,
  MARKET_FOCUS_VERTICALS,
  MAX_DRAWDOWN_OPTIONS,
  getAssetById,
} from '@hunch-it/shared';
import { TopAppBar } from '@/components/shell/top-app-bar';
import {
  STALE_SIGNER_ENV_ERROR,
  delegatedAccessError,
  deriveAutoExecuteSettingsState,
  waitForDelegatedAccessRevocation,
  withDelegatedAccessTimeout,
  type DelegatedExecutionSettingsStatus,
} from '@/lib/delegated-execution/settings-state';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useRuntime } from '@/lib/runtime/use-runtime';
import { useMandate, usePortfolio } from '@/lib/hooks/queries';
import { cn } from '@/lib/utils';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function SettingsPage() {
  const { address, connected, logout } = useWallet();

  const mandateQuery = useMandate();
  const portfolioQuery = usePortfolio();

  const mandate = mandateQuery.data?.mandate;
  const isLoading = mandateQuery.isLoading;
  const isPortfolioLoading = portfolioQuery.isLoading;

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

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus('copied');
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
      toast.error('Could not copy wallet address.');
    }
  };

  return (
    <>
      <TopAppBar title="Settings" />

      <main className="px-5 py-6 pb-24 max-w-md mx-auto flex flex-col gap-6">
        <Section icon={<UserRound className="h-5 w-5" />} title="Account">
          {!connected ? (
            <p className="text-body-md text-on-surface-variant">Not signed in.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  Wallet
                </span>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-body-md text-on-surface truncate">
                    {address ? shorten(address) : 'Not connected'}
                  </span>
                  {address && (
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      aria-label={
                        copyStatus === 'copied' ? 'Wallet address copied' : 'Copy wallet address'
                      }
                      className="w-11 h-11 rounded-full bg-surface-container-low text-primary flex items-center justify-center active:scale-[0.95] transition-transform hover:bg-surface-container-high"
                    >
                      {copyStatus === 'copied' ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Clipboard className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              {connected && (
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="self-start flex h-11 items-center gap-2 rounded-full px-3 text-label-md text-error transition-colors hover:bg-error-container"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              )}
            </div>
          )}
        </Section>

        <AutoExecuteTriggersCard />

        <Section icon={<BriefcaseBusiness className="h-5 w-5" />} title="Positions Overview">
          {isPortfolioLoading ? (
            <SkeletonRows rows={2} />
          ) : portfolioQuery.isError ? (
            <InlineError
              message="Could not load positions."
              onRetry={() => void portfolioQuery.refetch()}
            />
          ) : (
            <>
              <Row label="Active positions">
                <span className="tabular-nums">{positionsCount}</span>
              </Row>
              <div className="h-px bg-divider my-3" />
              <Row label="Total value">
                <span className="text-primary tabular-nums">
                  $
                  {positionsValue.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </Row>
            </>
          )}
        </Section>

        <Section
          icon={<SlidersHorizontal className="h-5 w-5" />}
          title="Your Mandate"
          right={
            mandate ? (
              <Link
                href="/mandate"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-surface-container-low px-4 text-label-md text-primary shadow-micro transition-colors active:scale-[0.97] hover:bg-surface-container-high"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit mandate
              </Link>
            ) : null
          }
        >
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : mandateQuery.isError ? (
            <InlineError
              message="Could not load your mandate."
              onRetry={() => void mandateQuery.refetch()}
            />
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
                {MAX_DRAWDOWN_OPTIONS.find((o) => o.value === mandate.maxDrawdown)?.label ??
                  'Custom'}
              </Row>
              <Row label="Max trade size">
                <span className="tabular-nums">${mandate.maxTradeSize.toFixed(2)}</span>
              </Row>
              <div className="flex flex-col gap-2">
                <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  Market focus
                </span>
                <div className="flex flex-wrap gap-2">
                  {verticalLabels.length === 0 && (
                    <span className="text-body-sm text-on-surface-variant">—</span>
                  )}
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
                Editing the mandate marks every active proposal as expired and the engine
                regenerates against the new parameters on its next cycle.
              </p>
            </div>
          )}
        </Section>

        <CloseAllPositionsCard />
      </main>
    </>
  );
}

function AutoExecuteTriggersCard() {
  const {
    connected,
    address,
    delegateWallet,
    revokeDelegatedWallets,
    refreshWalletUser,
    delegated: clientDelegated,
    authorizationSignerIdConfigured,
    delegationMode,
    walletClientType,
    connectorType,
    privyWalletId,
  } = useWallet();
  const authedFetch = useAuthedFetch();
  const [status, setStatus] = useState<DelegatedExecutionSettingsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'enable' | 'disable' | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!connected) {
      setStatus(null);
      return null;
    }
    setLoading(true);
    try {
      const res = await authedFetch('/api/delegated-execution/status');
      const body = (await res.json().catch(() => null)) as DelegatedExecutionSettingsStatus | null;
      if (!res.ok || !body) {
        const error = body && 'error' in body ? body.error : `status ${res.status}`;
        const next = { ok: false as const, error };
        setStatus(next);
        return next;
      }
      setStatus(body);
      return body;
    } catch (err) {
      const next = { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      setStatus(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [authedFetch, connected]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const { grantActive, statusLabel, statusTone, detail, blockerLabel, primaryAction } =
    deriveAutoExecuteSettingsState({
      connected,
      loading,
      status,
      clientDelegated,
    });
  const statusToneClass = {
    error: 'bg-error-container text-on-error-container',
    ready: 'bg-accent text-on-accent',
    setup: 'bg-tertiary-container text-on-tertiary-container',
    off: 'bg-surface-container-low text-on-surface-variant',
  }[statusTone];

  async function handleEnable() {
    if (!connected) return;
    setBusy('enable');
    try {
      const preflight = await refreshStatus();
      if (preflight?.ok && preflight.serverSigner.configured && !authorizationSignerIdConfigured) {
        throw delegatedAccessError('Restart the web dev server to expose the Privy signer ID.', {
          code: STALE_SIGNER_ENV_ERROR,
          serverSigner: preflight.serverSigner,
          wallet: {
            address,
            clientDelegated,
            connectorType,
            delegationMode,
            privyWalletId,
            walletClientType,
          },
        });
      }
      await withDelegatedAccessTimeout(delegateWallet());
      await refreshWalletUser().catch(() => null);
      const next = await refreshStatus();
      if (next?.ok && next.ready.canExecute) {
        toast.success('Auto-execute triggers enabled.');
      } else {
        toast('Delegation granted. Server readiness is still incomplete.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisable() {
    setBusy('disable');
    try {
      await waitForDelegatedAccessRevocation({
        revoke: revokeDelegatedWallets,
        readStatus: async () => {
          const next = await refreshStatus();
          if (!next?.ok) {
            throw delegatedAccessError(next?.error ?? 'Could not read delegated wallet status.', {
              code: 'delegated_status_unavailable',
              status: next,
            });
          }
          return next;
        },
      });
      void refreshWalletUser().catch(() => null);
      toast.success('Auto-execute triggers disabled.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const toggleDisabled = !connected || loading || busy !== null;

  return (
    <Section icon={<Zap className="h-5 w-5" />} title="Auto-execute triggers">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-label-sm', statusToneClass)}>
              {statusLabel}
            </span>
            {status?.ok === true && status.wallet.walletClientType && (
              <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-label-sm text-on-surface-variant">
                {status.wallet.walletClientType}
              </span>
            )}
          </div>
          <p className="text-body-sm leading-5 text-on-surface-variant">{detail}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={grantActive}
          aria-label={
            grantActive ? 'Disable auto-execute triggers' : 'Enable auto-execute triggers'
          }
          aria-busy={busy !== null}
          disabled={toggleDisabled}
          onClick={() => void (grantActive ? handleDisable() : handleEnable())}
          className={cn(
            'relative h-12 w-20 shrink-0 rounded-full p-1 ring-1 transition-colors duration-fast ease-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-[0.38]',
            grantActive
              ? 'bg-primary ring-primary'
              : 'bg-surface-container-low ring-outline-variant hover:bg-surface-container-high',
          )}
        >
          <span
            className={cn(
              'grid h-10 w-10 place-items-center rounded-full bg-surface text-primary shadow-micro transition-transform duration-fast ease-soft',
              grantActive ? 'translate-x-8' : 'translate-x-0',
            )}
          >
            {busy ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : grantActive ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Zap className="h-4 w-4 text-icon-muted" aria-hidden="true" />
            )}
          </span>
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void refreshStatus()}
          disabled={!connected || loading || busy !== null}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-surface-container-low px-4 text-label-md text-primary ring-1 ring-outline-variant transition-colors hover:bg-surface-container-high disabled:opacity-[0.38]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Check
        </button>
        {primaryAction === 'disable' ? (
          <button
            type="button"
            onClick={() => void handleDisable()}
            disabled={toggleDisabled}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-error-container px-4 text-label-md text-error transition-colors hover:bg-error-container/80 disabled:opacity-[0.38]"
          >
            {busy === 'disable' ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldOff className="h-4 w-4" aria-hidden="true" />
            )}
            Revoke
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleEnable()}
            disabled={toggleDisabled}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-label-md text-on-accent shadow-micro transition-colors hover:bg-accent-bright disabled:opacity-[0.38]"
          >
            {busy === 'enable' ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
            Enable
          </button>
        )}
      </div>

      <div className="mt-4 rounded-md bg-surface-container px-4 py-3">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-body-sm leading-5 text-on-surface-variant">
            Enabling delegates execution ability to Hunch for trigger fills. Your wallet stays
            non-custodial, and revoking removes that grant.
          </p>
        </div>
        {status?.ok === false && <p className="mt-2 text-body-sm text-error">{status.error}</p>}
        {blockerLabel && (
          <p className="mt-2 text-body-sm text-on-surface-variant">Blocked by {blockerLabel}.</p>
        )}
      </div>
    </Section>
  );
}

/**
 * Manual "panic close". Each live position needs at least one wallet sig
 * per swap, sequential by design so Privy modals don't stack.
 */
function CloseAllPositionsCard() {
  const router = useRouter();
  const runtime = useRuntime();
  const authedFetch = useAuthedFetch();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function closeOne(p: {
    id: string;
    ticker: string;
    tokenAmount: number;
    markPrice: number;
  }): Promise<void> {
    const meta = getAssetById(p.ticker);
    if (!meta?.mint) throw new Error(`${p.ticker} mint not configured`);
    await runtime.closePosition({
      positionId: p.id,
      meta: { mint: meta.mint, decimals: meta.decimals },
      fallbackMarkPrice: p.markPrice,
      tokenAmount: p.tokenAmount,
    });
  }

  async function handleCloseAll() {
    setBusy(true);
    try {
      const r = await authedFetch('/api/positions');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      const j = (await r.json().catch(() => ({ positions: [] }))) as {
        positions: Array<{ id: string; ticker: string; tokenAmount: number; entryPrice: number }>;
      };
      const targets = (j.positions ?? [])
        .filter((p) => p.tokenAmount > 0)
        .map((p) => ({
          id: p.id,
          ticker: p.ticker,
          tokenAmount: p.tokenAmount,
          markPrice: p.entryPrice,
        }));

      if (targets.length === 0) {
        toast('No open positions.');
        setConfirm(false);
        return;
      }

      setProgress({ done: 0, total: targets.length });
      let closed = 0;
      for (let i = 0; i < targets.length; i++) {
        try {
          await closeOne(targets[i]!);
          closed += 1;
        } catch (err) {
          toast.error(
            `Close ${targets[i]!.ticker} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        setProgress({ done: i + 1, total: targets.length });
      }

      if (closed === targets.length) {
        toast.success(`Closed ${closed} position${closed === 1 ? '' : 's'}.`);
        router.replace('/');
      } else if (closed > 0) {
        toast(`Closed ${closed}/${targets.length} positions. Review the failed swaps.`);
      } else {
        toast.error('No positions closed. Review the failed swaps and try again.');
      }
    } catch (err) {
      toast.error(`Panic close failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setProgress(null);
      setConfirm(false);
    }
  }

  return (
    <Section icon={<TriangleAlert className="h-5 w-5" />} title="Panic close">
      <p className="text-body-sm text-on-surface-variant mb-3">
        Cancel every open TP / SL synthetic order and market-sell every position you currently hold.
        Each position needs a wallet signature for the swap.
      </p>
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={busy}
          aria-busy={busy}
          className="flex items-center justify-center h-11 px-5 rounded-full bg-error text-on-error text-label-lg active:scale-[0.97] transition-transform disabled:opacity-50 hover:bg-error/90"
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
            aria-busy={busy}
            className="flex-[2] h-11 rounded-full bg-error text-on-error text-label-lg active:scale-[0.97] transition-transform disabled:opacity-50 hover:bg-error/90"
          >
            <span aria-live="polite">
              {busy
                ? progress
                  ? `Closing ${progress.done}/${progress.total}...`
                  : 'Closing...'
                : 'Confirm close all'}
            </span>
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
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface rounded-lg p-5 shadow-micro">
      <header className="flex items-center justify-between mb-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary"
            aria-hidden="true"
          >
            {icon}
          </span>
          <h2 className="text-title-md text-primary">{title}</h2>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      {children}
    </section>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`h-5 rounded-full bg-surface-container-high animate-pulse ${
            index % 2 === 0 ? 'w-3/4' : 'w-1/2'
          }`}
        />
      ))}
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-error-container px-4 py-3 text-on-error-container">
      <p className="text-body-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-full px-3 py-1 text-label-md text-error transition-colors hover:bg-surface/50"
      >
        Retry
      </button>
    </div>
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
