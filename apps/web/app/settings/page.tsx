'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  HOLDING_PERIOD_OPTIONS,
  MARKET_FOCUS_VERTICALS,
  MAX_DRAWDOWN_OPTIONS,
  XSTOCKS,
  xStockToBare,
  type Mandate,
  type XStockTicker,
} from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useDemoPositionsStore } from '@/lib/demo/positions';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { useJupiterTrigger } from '@/lib/jupiter/use-jupiter-trigger';

interface MandateResponse {
  mandate: Mandate | null;
}

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function SettingsPage() {
  const demo = isDemo();
  const { address, connected, logout } = useWallet();
  const wallet = demo ? 'demo-wallet' : address;

  const authedFetch = useAuthedFetch();
  const { data, isLoading } = useQuery<MandateResponse>({
    queryKey: ['mandate', wallet],
    queryFn: async () => {
      if (!wallet) return { mandate: null };
      const r = await authedFetch(`/api/mandates`);
      if (!r.ok) return { mandate: null };
      return r.json();
    },
    enabled: !!wallet,
  });

  const mandate = data?.mandate;
  const verticalLabels = (mandate?.marketFocus ?? []).map(
    (id) => MARKET_FOCUS_VERTICALS.find((v) => v.id === id)?.label ?? id,
  );

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ fontSize: 32, fontWeight: 800, margin: '16px 0 24px' }}
      >
        Settings
      </motion.h1>

      {/* Account */}
      <Card title="Account">
        {!connected && !demo ? (
          <p style={{ color: 'var(--color-fg-muted)' }}>Not connected.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Wallet">
              <code style={{ fontSize: 12 }}>{address ?? 'demo-wallet'}</code>
            </Row>
            <Row label="Mode">{demo ? 'Demo' : 'Live'}</Row>
          </div>
        )}
        {!demo && connected && (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 16 }}
            onClick={() => void logout()}
          >
            Sign out
          </button>
        )}
      </Card>

      {/* Mandate */}
      <Card title="Mandate" right={<Link href="/mandate" className="btn btn-ghost">Edit</Link>}>
        {isLoading && <p style={{ color: 'var(--color-fg-muted)' }}>Loading…</p>}
        {!isLoading && !mandate && (
          <div>
            <p style={{ color: 'var(--color-fg-muted)', marginBottom: 12 }}>
              No mandate yet. Without a mandate the signal engine doesn't generate proposals.
            </p>
            <Link href="/mandate" className="btn btn-primary">
              Set up mandate
            </Link>
          </div>
        )}
        {mandate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Holding period">
              {HOLDING_PERIOD_OPTIONS.find((o) => o.value === mandate.holdingPeriod)?.label ??
                mandate.holdingPeriod}
              <span style={{ color: 'var(--color-fg-muted)', marginLeft: 8 }}>
                {HOLDING_PERIOD_OPTIONS.find((o) => o.value === mandate.holdingPeriod)?.caption ??
                  ''}
              </span>
            </Row>
            <Row label="Max drawdown">
              {MAX_DRAWDOWN_OPTIONS.find((o) => o.value === mandate.maxDrawdown)?.label ??
                'Custom'}
            </Row>
            <Row label="Max trade size">${mandate.maxTradeSize.toFixed(2)}</Row>
            <Row label="Market focus">{verticalLabels.join(', ') || '—'}</Row>
          </div>
        )}
        {mandate && (
          <p
            style={{
              color: 'var(--color-fg-muted)',
              fontSize: 12,
              marginTop: 12,
              borderTop: '1px solid var(--color-border)',
              paddingTop: 12,
            }}
          >
            Editing the mandate will mark every active proposal as expired and the engine will
            regenerate against the new parameters on its next cycle.
          </p>
        )}
      </Card>

      <DelegationCard wallet={wallet ?? null} />
      <CloseAllPositionsCard />
    </main>
  );
}

/**
 * Manual "panic close" — iterates every ACTIVE / ENTERING position and
 * walks them through the same close flow as Position Detail. In demo mode
 * the demo store mutates synchronously; in live mode each position
 * requires the user to sign at least one cancel + one swap, so this is
 * sequential by design (parallel sigs would queue Privy modals on top of
 * each other).
 */
function CloseAllPositionsCard() {
  const demo = isDemo();
  const router = useRouter();
  const positions = useDemoPositionsStore((s) => s.positions);
  const closeDemoPosition = useDemoPositionsStore((s) => s.closePosition);
  const { swap } = useJupiterSwap();
  const { cancel: cancelTrigger } = useJupiterTrigger();
  const authedFetch = useAuthedFetch();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Demo positions are already in the store; in live mode we GET them lazily
  // when the user clicks (the live store isn't subscribed here).
  const openCount = demo
    ? positions.filter((p) => p.state !== 'CLOSED').length
    : null;

  async function closeOne(p: {
    id: string;
    ticker: string;
    tokenAmount: number;
    markPrice: number;
  }): Promise<void> {
    if (demo) {
      closeDemoPosition(p.id, 'USER_CLOSE', p.markPrice);
      return;
    }
    const meta = XSTOCKS[xStockToBare(p.ticker as XStockTicker)];
    if (!meta?.mint) throw new Error(`${p.ticker} mint not configured`);

    // 1) cancel any open TP/SL legs
    const ordersRes = await authedFetch('/api/orders');
    const j = (await ordersRes.json().catch(() => ({}))) as {
      orders?: Array<{
        id: string;
        positionId: string;
        kind: string;
        jupiterOrderId: string | null;
      }>;
    };
    for (const o of j.orders ?? []) {
      if (
        o.positionId !== p.id ||
        (o.kind !== 'TAKE_PROFIT' && o.kind !== 'STOP_LOSS') ||
        !o.jupiterOrderId
      )
        continue;
      try {
        await cancelTrigger(o.jupiterOrderId);
        await authedFetch(`/api/orders/${o.id}/cancel`, { method: 'POST' }).catch(() => {});
      } catch (err) {
        console.warn(`[close-all] cancel ${o.kind} failed`, err);
      }
    }

    // 2) market-sell
    const sell = await swap({
      direction: 'SELL',
      xStockMint: meta.mint,
      xStockDecimals: meta.decimals,
      sellAll: true,
    });
    const tokenAmt = Number(sell.inputAmount) / 10 ** meta.decimals;
    const usdOut = Number(sell.outputAmount) / 1_000_000;
    const executionPrice = tokenAmt > 0 ? usdOut / tokenAmt : null;

    // 3) persist
    await authedFetch(`/api/positions/${p.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executionPrice,
        tokenAmount: tokenAmt,
        txSignature: sell.exec.signature ?? null,
      }),
    }).catch(() => {});
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
          positions: Array<{
            id: string;
            ticker: string;
            tokenAmount: number;
            entryPrice: number;
          }>;
        };
        targets = (j.positions ?? []).map((p) => ({
          id: p.id,
          ticker: p.ticker,
          tokenAmount: p.tokenAmount,
          markPrice: p.entryPrice, // we don't have a live mark in this scope
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
    <Card title="Panic close">
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginBottom: 12 }}>
        Cancel every open TP / SL trigger order and market-sell every position you currently
        hold. Each position needs one wallet signature (cancel) plus one swap signature in live
        mode.
        {demo && openCount != null && (
          <>
            {' '}
            Demo store has <strong>{openCount}</strong> open position{openCount === 1 ? '' : 's'}.
          </>
        )}
      </p>
      {!confirm ? (
        <button className="btn btn-sell" onClick={() => setConfirm(true)} disabled={busy}>
          Close all positions
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={() => setConfirm(false)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="btn btn-sell"
            style={{ flex: 2 }}
            onClick={() => void handleCloseAll()}
            disabled={busy}
          >
            {busy
              ? progress
                ? `Closing ${progress.done}/${progress.total}…`
                : 'Closing…'
              : 'Confirm close all'}
          </button>
        </div>
      )}
    </Card>
  );
}

/**
 * Phase F — Delegated signing toggle.
 * When the user enables this, the server (Privy server signers) is allowed
 * to sign Jupiter trigger-order cancel/place transactions for the user's
 * automated TP/SL flows. Off by default; users can flip it at any time.
 */
function DelegationCard({ wallet }: { wallet: string | null }) {
  const demo = isDemo();
  const [active, setActive] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const authedFetch = useAuthedFetch();
  const { delegateSolanaWallet, revokeDelegations } = useWallet();

  useEffect(() => {
    if (!wallet || demo) return;
    // We don't have a /api/users GET — read delegationActive from localStorage
    // mirror after a successful PATCH below. Fine for Phase F since this is
    // an opt-in flag the user controls.
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
      // Real Privy grant / revoke. Requires the Privy app to be on a plan
      // that supports server signers; on Free the SDK throws, in which case
      // we still persist the intent so the user can retry once the app is
      // upgraded. ws-server gates `tryDelegatedCancel` on both
      // `delegationActive` AND `PRIVY_APP_SECRET` so the off-state is safe.
      if (!demo) {
        try {
          if (next) await delegateSolanaWallet();
          else await revokeDelegations();
        } catch (err) {
          // Don't bail — the toggle state still persists so the user knows
          // their intent. The auto-cancel path stays a no-op until grant
          // succeeds (e.g. after Privy plan upgrade or SDK retry).
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
        throw new Error(j.error ?? `${res.status}`);
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
    <Card title="Auto-exit signing">
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginBottom: 12 }}>
        Allow the Hunch server to cancel a paired exit order automatically when its sibling
        fills (OCO behaviour), and to place TP / SL after a BUY fills, without prompting you
        to sign each time.
      </p>
      <ul
        style={{
          color: 'var(--color-fg-muted)',
          fontSize: 13,
          marginBottom: 12,
          paddingLeft: 20,
          lineHeight: 1.7,
        }}
      >
        <li>Scope is constrained to Jupiter trigger orders for positions you opened.</li>
        <li>You can revoke it any time below.</li>
        <li>Every server-signed transaction is recorded against your account.</li>
      </ul>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          className={active ? 'btn btn-buy' : 'btn btn-primary'}
          disabled={busy}
          onClick={() => void toggle(!active)}
        >
          {busy ? 'Saving…' : active ? 'Disable auto-exit' : 'Enable auto-exit'}
        </button>
        <span
          style={{
            fontSize: 13,
            color: active ? 'var(--color-buy)' : 'var(--color-fg-muted)',
          }}
        >
          {active ? '✓ Auto-exit active' : 'Manual confirmation required for cancels'}
        </span>
      </div>
    </Card>
  );
}

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ marginBottom: 16 }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
        {right}
      </div>
      {children}
    </motion.div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{children}</span>
    </div>
  );
}
