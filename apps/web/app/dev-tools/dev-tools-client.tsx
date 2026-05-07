'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Clipboard,
  ExternalLink,
  KeyRound,
  LogOut,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Wand2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BARE_TICKERS,
  USDC_DECIMALS,
  XSTOCKS,
  xStockToBare,
  type BareTicker,
  type Proposal,
  type XStockTicker,
} from '@hunch-it/shared';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { QK } from '@/lib/hooks/queries';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { isLiveProposal } from '@/lib/proposals/expiration';
import { useRuntime } from '@/lib/runtime/use-runtime';
import { useProposalsStore } from '@/lib/store/proposals';
import { useWallet } from '@/lib/wallet/use-wallet';

type LogSection = 'auth' | 'proposal' | 'orders' | 'protection' | 'swap';
type LogView = LogSection | 'all';

interface LogEntry {
  timestamp: string;
  requestId: string;
  step: string;
  payload?: unknown;
  response?: unknown;
  latencyMs: number;
  error?: string;
}

interface DevOrder {
  id: string;
  positionId: string;
  kind: 'BUY_TRIGGER' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'CLOSE_SWAP';
  side: 'BUY' | 'SELL' | string;
  status: string;
  triggerPriceUsd: number | null;
  sizeUsd: number;
  tokenAmount: number | null;
  ticker: string;
  mint: string;
  positionState: string;
  proposalId: string | null;
  createdAt: string;
}

interface DevPosition {
  id: string;
  ticker: string;
  mint: string;
  tokenAmount: number;
  entryPrice: number;
  currentTpPrice: number | null;
  currentSlPrice: number | null;
  state: string;
}

interface DevState {
  proposals: Proposal[];
  orders: DevOrder[];
  positions: DevPosition[];
}

interface SessionState {
  enabled: boolean;
  authenticated: boolean;
}

const emptyLogs: Record<LogSection, LogEntry[]> = {
  auth: [],
  proposal: [],
  orders: [],
  protection: [],
  swap: [],
};

const LOG_SECTIONS: LogSection[] = ['auth', 'proposal', 'orders', 'protection', 'swap'];

const LOG_LABELS: Record<LogSection, string> = {
  auth: 'Auth',
  proposal: 'Proposal',
  orders: 'Orders',
  protection: 'Protection',
  swap: 'Swap',
};

function requestId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function logToText(entries: LogEntry[]): string {
  return entries.map((entry) => stringify(entry)).join('\n\n');
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function stagedDevProposal(proposals: Proposal[], nowMs = Date.now()): Proposal | null {
  return proposals.find((p) => isLiveProposal(p, nowMs)) ?? null;
}

export function DevToolsClient() {
  const authedFetch = useAuthedFetch();
  const { connected, login, publicKey } = useWallet();
  const { swap } = useJupiterSwap();
  const runtime = useRuntime();
  const qc = useQueryClient();
  const upsertProposal = useProposalsStore((s) => s.upsertProposal);
  const removeProposal = useProposalsStore((s) => s.removeProposal);

  const [session, setSession] = useState<SessionState | null>(null);
  const [password, setPassword] = useState('');
  const [ticker, setTicker] = useState<BareTicker>('AAPL');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [devState, setDevState] = useState<DevState>({ proposals: [], orders: [], positions: [] });
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [selectedPositionId, setSelectedPositionId] = useState<string>('');
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<LogSection, LogEntry[]>>(emptyLogs);
  const [selectedLogView, setSelectedLogView] = useState<LogView>('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const walletAddress = publicKey?.toBase58() ?? null;
  const selectedOrder = useMemo(
    () => devState.orders.find((order) => order.id === selectedOrderId) ?? null,
    [devState.orders, selectedOrderId],
  );
  const activePositions = useMemo(
    () => devState.positions.filter((position) => position.state === 'ACTIVE'),
    [devState.positions],
  );
  const selectedPosition = useMemo(
    () => activePositions.find((position) => position.id === selectedPositionId) ?? null,
    [activePositions, selectedPositionId],
  );
  const openOrders = useMemo(
    () => devState.orders.filter((order) => order.status === 'OPEN'),
    [devState.orders],
  );
  const activeProposal = useMemo(() => {
    if (proposal && isLiveProposal(proposal, nowMs)) return proposal;
    return stagedDevProposal(devState.proposals, nowMs);
  }, [devState.proposals, nowMs, proposal]);

  const appendLog = useCallback((section: LogSection, entry: LogEntry) => {
    setLogs((prev) => ({
      ...prev,
      [section]: [entry, ...prev[section]].slice(0, 20),
    }));
  }, []);

  const runLogged = useCallback(
    async <T,>(
      section: LogSection,
      step: string,
      payload: unknown,
      fn: () => Promise<T>,
    ): Promise<T> => {
      const id = requestId();
      const start = performance.now();
      try {
        const response = await fn();
        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          requestId: id,
          step,
          payload,
          response,
          latencyMs: Math.round(performance.now() - start),
        };
        appendLog(section, entry);
        console.groupCollapsed(`[dev-tools] ${step} ${id}`);
        console.log('payload', payload);
        console.log('response', response);
        console.log('latencyMs', entry.latencyMs);
        console.groupEnd();
        return response;
      } catch (err) {
        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          requestId: id,
          step,
          payload,
          latencyMs: Math.round(performance.now() - start),
          error: err instanceof Error ? err.message : String(err),
        };
        appendLog(section, entry);
        console.groupCollapsed(`[dev-tools] ${step} ${id} error`);
        console.log('payload', payload);
        console.error(err);
        console.log('latencyMs', entry.latencyMs);
        console.groupEnd();
        throw err;
      }
    },
    [appendLog],
  );

  const fetchSessionStatus = useCallback(async () => {
    const res = await fetch('/api/dev-tools/session', { cache: 'no-store' });
    return (await res.json()) as SessionState;
  }, []);

  const refreshSession = useCallback(
    async ({ log = false }: { log?: boolean } = {}) => {
      const next = log
        ? await runLogged('auth', 'session.status', {}, fetchSessionStatus)
        : await fetchSessionStatus();
      setSession(next);
    },
    [fetchSessionStatus, runLogged],
  );

  const refreshDevState = useCallback(async () => {
    const next = await runLogged('orders', 'state.refresh', {}, async () => {
      const res = await authedFetch('/api/dev-tools/orders');
      const json = (await res.json().catch(() => ({}))) as DevState & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `${res.status}`);
      return json;
    });
    setDevState({
      proposals: next.proposals ?? [],
      orders: next.orders ?? [],
      positions: next.positions ?? [],
    });
    const nowMs = Date.now();
    const proposals = next.proposals ?? [];
    const activeProposal = stagedDevProposal(proposals, nowMs);
    const inactiveProposalIds = new Set(
      proposals.filter((p) => !isLiveProposal(p, nowMs)).map((p) => p.id),
    );
    for (const p of proposals) {
      if (!isLiveProposal(p, nowMs)) removeProposal(p.id);
    }
    if (activeProposal) {
      upsertProposal(activeProposal);
    }
    qc.setQueryData<{ proposals: Proposal[] }>(QK.proposals(), (current) => {
      const existing = current?.proposals ?? [];
      const cachedProposals = existing.filter(
        (p) =>
          p.id !== activeProposal?.id && !inactiveProposalIds.has(p.id) && isLiveProposal(p, nowMs),
      );
      return {
        proposals: activeProposal ? [activeProposal, ...cachedProposals] : cachedProposals,
      };
    });
    setProposal((current) => {
      if (!current) return activeProposal;
      const refreshedCurrent = proposals.find((p) => p.id === current.id);
      if (refreshedCurrent && isLiveProposal(refreshedCurrent, nowMs)) return refreshedCurrent;
      return activeProposal;
    });
  }, [authedFetch, qc, removeProposal, runLogged, upsertProposal]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!session?.authenticated || !connected) return;
    void refreshDevState().catch(() => {});
  }, [session?.authenticated, connected, refreshDevState]);

  useEffect(() => {
    if (!proposal || isLiveProposal(proposal, nowMs)) return;
    removeProposal(proposal.id);
    setProposal(null);
    void qc.invalidateQueries({ queryKey: QK.proposals() });
    if (session?.authenticated && connected) void refreshDevState().catch(() => {});
  }, [connected, nowMs, proposal, qc, refreshDevState, removeProposal, session?.authenticated]);

  useEffect(() => {
    if (!selectedOrderId && openOrders[0]) setSelectedOrderId(openOrders[0].id);
  }, [openOrders, selectedOrderId]);

  useEffect(() => {
    if (!selectedPositionId && activePositions[0]) setSelectedPositionId(activePositions[0].id);
  }, [activePositions, selectedPositionId]);

  useEffect(() => {
    if (!selectedPosition) return;
    setTpPrice(selectedPosition.currentTpPrice?.toString() ?? '');
    setSlPrice(selectedPosition.currentSlPrice?.toString() ?? '');
  }, [selectedPosition]);

  async function loginDevTools() {
    setBusy('auth');
    try {
      await runLogged('auth', 'session.login', { password: '[redacted]' }, async () => {
        const res = await fetch('/api/dev-tools/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        return json;
      });
      setPassword('');
      await refreshSession({ log: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function logoutDevTools() {
    await runLogged('auth', 'session.logout', {}, async () => {
      const res = await fetch('/api/dev-tools/session', { method: 'DELETE' });
      return res.json();
    });
    setSession({ enabled: true, authenticated: false });
  }

  async function generateProposal() {
    if (activeProposal) {
      toast.error('Skip the active proposal or wait for it to expire before generating another.');
      return;
    }
    setBusy('generate');
    try {
      const result = await runLogged('proposal', 'proposal.generate', { ticker }, async () => {
        const res = await authedFetch('/api/dev-tools/proposals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          proposal?: Proposal;
          error?: string;
        };
        if (!res.ok) {
          if (res.status === 409 && json.error === 'active_dev_tools_proposal_exists') {
            throw new Error('Active dev-tools proposal already exists.');
          }
          throw new Error(json.error ?? `${res.status}`);
        }
        return json;
      });
      const createdProposal = result.proposal;
      if (createdProposal) {
        setProposal(createdProposal);
        upsertProposal(createdProposal);
        qc.setQueryData<{ proposals: Proposal[] }>(QK.proposals(), (current) => {
          const existing = current?.proposals ?? [];
          const nowMs = Date.now();
          return {
            proposals: [
              createdProposal,
              ...existing.filter((p) => p.id !== createdProposal.id && isLiveProposal(p, nowMs)),
            ],
          };
        });
      }
      toast.success('Proposal created.');
      await refreshDevState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function acceptProposal() {
    const proposalToAccept = activeProposal;
    if (!proposalToAccept) return;
    const walletAddress = publicKey?.toBase58();
    if (!walletAddress) {
      toast.error('Connect a wallet first.');
      return;
    }
    const meta = XSTOCKS[xStockToBare(proposalToAccept.ticker as XStockTicker)];
    if (!meta?.mint) {
      toast.error(`${proposalToAccept.ticker} mint not configured.`);
      return;
    }
    setBusy('accept');
    try {
      const result = await runLogged(
        'proposal',
        'proposal.accept',
        { proposalId: proposalToAccept.id },
        async () => {
          const res = await authedFetch('/api/orders', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              walletAddress,
              proposalId: proposalToAccept.id,
              ticker: proposalToAccept.ticker,
              kind: 'BUY_TRIGGER',
              side: 'BUY',
              triggerPriceUsd: proposalToAccept.suggestedTriggerPrice,
              sizeUsd: proposalToAccept.suggestedSizeUsd,
              jupiterOrderId: null,
              txSignature: null,
              slippageBps: 50,
              createPosition: {
                mint: meta.mint,
                entryPriceEstimate: proposalToAccept.suggestedTriggerPrice,
                tpPrice: proposalToAccept.suggestedTakeProfitPrice,
                slPrice: proposalToAccept.suggestedStopLossPrice,
              },
            }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            order?: { id?: string };
            positionId?: string;
            error?: string;
          };
          if (!res.ok) throw new Error(json.error ?? `${res.status}`);
          return json;
        },
      );
      if (result.order?.id) setSelectedOrderId(result.order.id);
      removeProposal(proposalToAccept.id);
      setProposal(null);
      toast.success('Order and position created.');
      await refreshDevState();
      void qc.invalidateQueries({ queryKey: QK.proposals() });
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function forceTrigger(orderId = selectedOrderId) {
    if (!orderId) return;
    setBusy(`force:${orderId}`);
    try {
      await runLogged('orders', 'order.forceTrigger', { orderId }, async () => {
        const res = await authedFetch(`/api/dev-tools/orders/${orderId}/force-trigger`, {
          method: 'POST',
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        return json;
      });
      toast.success('Trigger emitted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function executeOrder() {
    if (!selectedOrder) return;
    const meta = XSTOCKS[xStockToBare(selectedOrder.ticker as XStockTicker)];
    if (!meta?.mint) {
      toast.error(`${selectedOrder.ticker} mint not configured.`);
      return;
    }
    setBusy('execute');
    try {
      await runLogged('swap', 'order.executeSwap', { orderId: selectedOrder.id }, async () => {
        const result =
          selectedOrder.kind === 'BUY_TRIGGER'
            ? await swap({
                direction: 'BUY',
                xStockMint: meta.mint,
                xStockDecimals: meta.decimals,
                usdAmount: selectedOrder.sizeUsd,
              })
            : selectedOrder.tokenAmount && selectedOrder.tokenAmount > 0
              ? await swap({
                  direction: 'SELL',
                  xStockMint: meta.mint,
                  xStockDecimals: meta.decimals,
                  tokenAmount: selectedOrder.tokenAmount,
                })
              : await swap({
                  direction: 'SELL',
                  xStockMint: meta.mint,
                  xStockDecimals: meta.decimals,
                  sellAll: true,
                });

        if (result.exec.status !== 'Success') throw new Error(result.exec.error ?? 'swap failed');
        const tokenAmount =
          selectedOrder.kind === 'BUY_TRIGGER'
            ? Number(result.outputAmount) / 10 ** meta.decimals
            : Number(result.inputAmount) / 10 ** meta.decimals;
        const usdValue =
          selectedOrder.kind === 'BUY_TRIGGER'
            ? Number(result.inputAmount) / 10 ** USDC_DECIMALS
            : Number(result.outputAmount) / 10 ** USDC_DECIMALS;
        const executionPrice =
          tokenAmount > 0
            ? usdValue / tokenAmount
            : (selectedOrder.triggerPriceUsd ?? selectedOrder.sizeUsd);

        const res = await authedFetch(`/api/orders/${selectedOrder.id}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            txSignature: result.exec.signature ?? `unknown-${Date.now()}`,
            executionPrice,
            tokenAmount,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        return { swap: result.exec, settle: json, executionPrice, tokenAmount };
      });
      toast.success('Swap settled.');
      await refreshDevState();
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.portfolio() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function adjustProtection() {
    if (!selectedPosition) return;
    const body = {
      ...(tpPrice ? { tpPrice: Number(tpPrice) } : {}),
      ...(slPrice ? { slPrice: Number(slPrice) } : {}),
    };
    setBusy('protection');
    try {
      await runLogged(
        'protection',
        'position.protection',
        { positionId: selectedPosition.id, ...body },
        async () => {
          const res = await authedFetch(`/api/positions/${selectedPosition.id}/protection`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(json.error ?? `${res.status}`);
          return json;
        },
      );
      toast.success('Protection updated.');
      await refreshDevState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function closePosition() {
    if (!selectedPosition) return;
    const meta = XSTOCKS[xStockToBare(selectedPosition.ticker as XStockTicker)];
    if (!meta?.mint) {
      toast.error(`${selectedPosition.ticker} mint not configured.`);
      return;
    }
    setBusy('close');
    try {
      await runLogged(
        'swap',
        'position.manualClose',
        { positionId: selectedPosition.id },
        async () => {
          return runtime.closePosition({
            positionId: selectedPosition.id,
            meta: { mint: meta.mint, decimals: meta.decimals },
            fallbackMarkPrice: selectedPosition.entryPrice,
            tokenAmount: selectedPosition.tokenAmount,
          });
        },
      );
      toast.success('Position closed.');
      await refreshDevState();
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.portfolio() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const allLogs = useMemo(
    () =>
      Object.values(logs)
        .flat()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [logs],
  );

  if (session && !session.enabled) {
    return (
      <>
        <TopAppBar title="Dev tools" />
        <main className="mx-auto max-w-3xl px-5 py-8">
          <section className="rounded-lg bg-surface p-5 shadow-soft">
            <h1 className="text-title-lg text-primary">Unavailable</h1>
            <p className="mt-2 text-body-sm text-on-surface-variant">Dev tools are disabled.</p>
          </section>
        </main>
      </>
    );
  }

  if (!session?.authenticated) {
    return (
      <>
        <TopAppBar title="Dev tools" />
        <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center px-5 py-8">
          <section className="w-full rounded-lg bg-surface p-5 shadow-soft">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent">
              <KeyRound aria-hidden className="h-5 w-5" />
            </div>
            <h1 className="text-title-lg text-primary">Password required</h1>
            <div className="mt-5 flex flex-col gap-3">
              <label className="text-label-sm text-on-surface-variant" htmlFor="dev-password">
                Password
              </label>
              <input
                id="dev-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loginDevTools();
                }}
                className="h-12 rounded-full bg-surface-container-low px-4 text-body-md text-primary outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => void loginDevTools()}
                disabled={!password || busy === 'auth'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <ShieldCheck aria-hidden className="h-4 w-4" />
                {busy === 'auth' ? 'Checking...' : 'Unlock'}
              </button>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <TopAppBar
        title="Dev tools"
        rightAction={
          <button
            type="button"
            title="Lock dev tools"
            onClick={() => void logoutDevTools()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-primary shadow-micro"
          >
            <LogOut aria-hidden className="h-4 w-4" />
          </button>
        }
      />
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-5 py-6 pb-24">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusPill
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Session"
            value="Unlocked"
            detail="Password cookie active"
          />
          <StatusPill
            icon={<Zap className="h-4 w-4" />}
            label="Wallet"
            value={connected ? 'Connected' : 'Signed out'}
            detail={
              walletAddress ? shortAddress(walletAddress) : 'Connect to create and execute orders'
            }
          />
          <StatusPill
            icon={<Wand2 className="h-4 w-4" />}
            label="Proposals"
            value={activeProposal ? '1' : '0'}
            detail={
              activeProposal ? `${activeProposal.ticker} staged for accept` : 'No staged proposal'
            }
          />
          <StatusPill
            icon={<SlidersHorizontal className="h-4 w-4" />}
            label="Positions"
            value={activePositions.length.toString()}
            detail={`${openOrders.length} open orders`}
          />
        </section>

        {!connected && (
          <section className="rounded-lg bg-tertiary-container p-4 text-on-tertiary-container">
            <button
              type="button"
              onClick={login}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-on-primary"
            >
              <KeyRound aria-hidden className="h-4 w-4" />
              Sign in
            </button>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-2">
          <Panel title="Proposal lab" icon={<Wand2 className="h-5 w-5" />}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <select
                value={ticker}
                onChange={(event) => setTicker(event.target.value as BareTicker)}
                className="h-12 rounded-full bg-surface-container-low px-4 text-label-lg text-primary outline-none ring-1 ring-outline-variant"
              >
                {BARE_TICKERS.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}x
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void generateProposal()}
                disabled={!connected || busy === 'generate' || Boolean(activeProposal)}
                title={
                  activeProposal
                    ? 'Skip the active proposal or wait for it to expire before generating another.'
                    : undefined
                }
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 text-label-lg text-on-accent transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <Wand2 aria-hidden className="h-4 w-4" />
                {busy === 'generate' ? 'Generating...' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={() => void acceptProposal()}
                disabled={!activeProposal || !connected || busy === 'accept'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <Check aria-hidden className="h-4 w-4" />
                {busy === 'accept' ? 'Accepting...' : 'Accept'}
              </button>
            </div>
            {activeProposal && (
              <div className="mt-4 rounded-md bg-surface-container-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-title-md text-primary">{activeProposal.ticker}</p>
                    <p className="text-body-sm text-on-surface-variant">{activeProposal.id}</p>
                  </div>
                  <Link
                    href={`/proposals/${activeProposal.id}`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-surface px-4 text-label-md text-primary"
                  >
                    <ExternalLink aria-hidden className="h-4 w-4" />
                    Open
                  </Link>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-body-sm">
                  <Metric label="Size" value={fmtUsd(activeProposal.suggestedSizeUsd)} />
                  <Metric label="Trigger" value={fmtUsd(activeProposal.suggestedTriggerPrice)} />
                  <Metric label="TP" value={fmtUsd(activeProposal.suggestedTakeProfitPrice)} />
                  <Metric label="SL" value={fmtUsd(activeProposal.suggestedStopLossPrice)} />
                </dl>
              </div>
            )}
            <LogBlock title="Proposal log" entries={logs.proposal} compact />
          </Panel>

          <Panel title="Orders" icon={<Zap className="h-5 w-5" />}>
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <select
                  value={selectedOrderId}
                  onChange={(event) => setSelectedOrderId(event.target.value)}
                  className="min-w-0 flex-1 rounded-full bg-surface-container-low px-4 text-label-md text-primary outline-none ring-1 ring-outline-variant"
                >
                  <option value="">No order selected</option>
                  {openOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.kind} {order.ticker} {fmtUsd(order.triggerPriceUsd)}
                    </option>
                  ))}
                </select>
                <IconButton
                  title="Refresh"
                  onClick={() => void refreshDevState()}
                  icon={<RefreshCw className="h-4 w-4" />}
                />
              </div>
              {selectedOrder && (
                <div className="rounded-md bg-surface-container-low p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-title-md text-primary">{selectedOrder.kind}</p>
                      <p className="text-body-sm text-on-surface-variant">{selectedOrder.id}</p>
                    </div>
                    <span className="rounded-full bg-primary px-3 py-1 text-label-sm text-on-primary">
                      {selectedOrder.status}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-body-sm">
                    <Metric label="Ticker" value={selectedOrder.ticker} />
                    <Metric label="Trigger" value={fmtUsd(selectedOrder.triggerPriceUsd)} />
                    <Metric label="Size" value={fmtUsd(selectedOrder.sizeUsd)} />
                    <Metric label="Tokens" value={selectedOrder.tokenAmount?.toFixed(6) ?? '-'} />
                  </dl>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void forceTrigger()}
                  disabled={!selectedOrder || busy?.startsWith('force')}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-4 text-label-lg text-on-accent transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Zap aria-hidden className="h-4 w-4" />
                  Force trigger
                </button>
                <button
                  type="button"
                  onClick={() => void executeOrder()}
                  disabled={!selectedOrder || busy === 'execute'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Play aria-hidden className="h-4 w-4" />
                  {busy === 'execute' ? 'Executing...' : 'Execute swap'}
                </button>
              </div>
            </div>
            <LogBlock title="Order log" entries={logs.orders} compact />
          </Panel>

          <Panel title="Protection" icon={<SlidersHorizontal className="h-5 w-5" />}>
            <div className="flex flex-col gap-3">
              <select
                value={selectedPositionId}
                onChange={(event) => setSelectedPositionId(event.target.value)}
                className="h-12 rounded-full bg-surface-container-low px-4 text-label-md text-primary outline-none ring-1 ring-outline-variant"
              >
                <option value="">No active position</option>
                {activePositions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.ticker} {position.tokenAmount.toFixed(4)}
                  </option>
                ))}
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput label="TP" value={tpPrice} onChange={setTpPrice} />
                <LabeledInput label="SL" value={slPrice} onChange={setSlPrice} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void adjustProtection()}
                  disabled={!selectedPosition || busy === 'protection'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <SlidersHorizontal aria-hidden className="h-4 w-4" />
                  Update TP/SL
                </button>
                <button
                  type="button"
                  onClick={() => void closePosition()}
                  disabled={!selectedPosition || busy === 'close'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-negative px-4 text-label-lg text-on-negative transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Play aria-hidden className="h-4 w-4" />
                  Manual close
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {openOrders
                  .filter(
                    (order) =>
                      order.positionId === selectedPositionId && order.kind !== 'BUY_TRIGGER',
                  )
                  .map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => void forceTrigger(order.id)}
                      disabled={busy === `force:${order.id}`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-surface-container-low px-4 text-label-md text-primary ring-1 ring-outline-variant disabled:opacity-50"
                    >
                      <Zap aria-hidden className="h-4 w-4" />
                      {order.kind === 'TAKE_PROFIT' ? 'Force TP' : 'Force SL'}
                    </button>
                  ))}
              </div>
            </div>
            <LogBlock title="Protection log" entries={logs.protection} compact />
          </Panel>

          <Panel title="Logs" icon={<Clipboard className="h-5 w-5" />}>
            <LogReview
              selected={selectedLogView}
              onSelect={setSelectedLogView}
              logs={logs}
              allLogs={allLogs}
            />
          </Panel>
        </section>
      </main>
    </>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-surface p-5 shadow-soft">
      <header className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-low text-primary">
          {icon}
        </span>
        <h2 className="text-title-md text-primary">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label-sm text-on-surface-variant">{label}</dt>
      <dd className="mt-1 font-mono text-label-md text-primary">{value}</dd>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
      {label}
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 rounded-full bg-surface-container-low px-4 font-mono text-body-md text-primary outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}

function IconButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-primary ring-1 ring-outline-variant transition-transform active:scale-[0.97]"
    >
      {icon}
    </button>
  );
}

function StatusPill({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3 shadow-micro">
      <div className="flex min-w-0 items-start gap-3 text-primary">
        {icon}
        <div className="min-w-0">
          <p className="text-label-sm text-on-surface-variant">{label}</p>
          <p className="mt-0.5 truncate text-label-lg text-primary">{value}</p>
          <p className="mt-1 truncate text-body-sm text-on-surface-variant">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function LogReview({
  selected,
  onSelect,
  logs,
  allLogs,
}: {
  selected: LogView;
  onSelect: (view: LogView) => void;
  logs: Record<LogSection, LogEntry[]>;
  allLogs: LogEntry[];
}) {
  const views: LogView[] = [...LOG_SECTIONS, 'all'];
  const entries = selected === 'all' ? allLogs : logs[selected];
  const text = logToText(entries);
  const title = selected === 'all' ? 'All logs' : `${LOG_LABELS[selected]} log`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {views.map((view) => {
          const count = view === 'all' ? allLogs.length : logs[view].length;
          const active = selected === view;
          return (
            <button
              key={view}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(view)}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-full px-3 text-label-md ring-1 transition-colors ${
                active
                  ? 'bg-primary text-on-primary ring-primary'
                  : 'bg-surface-container-low text-primary ring-outline-variant'
              }`}
            >
              {view === 'all' ? 'All' : LOG_LABELS[view]}
              <span
                className={`rounded-full px-2 py-0.5 text-label-sm ${
                  active ? 'bg-on-primary text-primary' : 'bg-surface text-on-surface-variant'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="rounded-md bg-surface-container-low p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-label-md text-primary">{title}</h3>
            <p className="text-body-sm text-on-surface-variant">
              Review {entries.length} {entries.length === 1 ? 'entry' : 'entries'} before copying.
            </p>
          </div>
          <CopyButton
            label={`copy ${selected === 'all' ? 'all' : LOG_LABELS[selected].toLowerCase()}`}
            text={text}
          />
        </div>
        <pre className="max-h-72 overflow-auto rounded-md bg-primary p-3 text-[11px] leading-4 text-on-primary">
          {text || '[]'}
        </pre>
      </div>
    </div>
  );
}

function LogBlock({
  title,
  entries,
  compact,
}: {
  title: string;
  entries: LogEntry[];
  compact?: boolean;
}) {
  const text = logToText(entries);
  return (
    <div className={compact ? 'mt-4' : 'mt-5'}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-label-md text-on-surface-variant">{title}</h3>
        <CopyButton label="copy" text={text} />
      </div>
      <pre
        className={`${compact ? 'max-h-40' : 'max-h-72'} overflow-auto rounded-md bg-primary p-3 text-[11px] leading-4 text-on-primary`}
      >
        {text || '[]'}
      </pre>
    </div>
  );
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(text || '[]').then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-surface-container-low px-3 text-label-md text-primary ring-1 ring-outline-variant"
    >
      {copied ? (
        <Check aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <Clipboard aria-hidden className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}
