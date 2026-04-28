'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { isDemo } from '@/lib/demo';
import { useDemoPositionsStore } from '@/lib/demo/positions';
import { useWallet } from '@/lib/wallet/use-wallet';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';
import { useJupiterTrigger } from '@/lib/jupiter/use-jupiter-trigger';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';

export default function PositionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const demo = isDemo();
  const position = useDemoPositionsStore((s) =>
    params?.id ? s.positions.find((p) => p.id === params.id) ?? null : null,
  );
  const adjustTpSl = useDemoPositionsStore((s) => s.adjustTpSl);
  const closePosition = useDemoPositionsStore((s) => s.closePosition);
  const confirmExitOrders = useDemoPositionsStore((s) => s.confirmExitOrders);
  const simulateExitFill = useDemoPositionsStore((s) => s.simulateExitFill);
  const dismissCancelSibling = useDemoPositionsStore((s) => s.dismissCancelSibling);
  const cancelSiblingHint = useDemoPositionsStore((s) =>
    params?.id ? s.cancelSiblingHints[params.id] ?? null : null,
  );
  const { placeSellExit, cancel: cancelTrigger } = useJupiterTrigger();
  const { swap } = useJupiterSwap();
  const { address } = useWallet();

  // Fetch + cancel open SELL trigger orders attached to this Position. Returns
  // a list of the {id, jupiterOrderId, kind} we cancelled. The persistence
  // ack (POST /api/orders/[id]/cancel) is fire-and-forget on success — the
  // Order Tracker will still reconcile via Jupiter History.
  async function cancelSiblingOrders(): Promise<
    Array<{ id: string; kind: string; jupiterOrderId: string }>
  > {
    if (!position) return [];
    const ordersRes = await fetch(`/api/orders?wallet=${address ?? ''}`);
    const j = (await ordersRes.json().catch(() => ({}))) as {
      orders?: Array<{
        id: string;
        positionId: string;
        kind: string;
        jupiterOrderId: string | null;
      }>;
    };
    const open = (j.orders ?? []).filter(
      (o) =>
        o.positionId === position.id &&
        (o.kind === 'TAKE_PROFIT' || o.kind === 'STOP_LOSS') &&
        o.jupiterOrderId,
    );
    const cancelled: Array<{ id: string; kind: string; jupiterOrderId: string }> = [];
    for (const o of open) {
      try {
        await cancelTrigger(o.jupiterOrderId!);
        await fetch(`/api/orders/${o.id}/cancel`, { method: 'POST' }).catch(() => {});
        cancelled.push({ id: o.id, kind: o.kind, jupiterOrderId: o.jupiterOrderId! });
      } catch (err) {
        // Surface but don't bail — the user may want partial progress.
        toast.error(
          `Cancel ${o.kind} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return cancelled;
  }

  const [bars, setBars] = useState<ChartBar[]>([]);
  const [tpDraft, setTpDraft] = useState('');
  const [slDraft, setSlDraft] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!position) return;
    setTpDraft(position.currentTpPrice?.toString() ?? '');
    setSlDraft(position.currentSlPrice?.toString() ?? '');
    let cancelled = false;
    const bare = xStockToBare(position.ticker as XStockTicker);
    fetch(`/api/bars/${bare}?resolution=5&hours=24`)
      .then((r) => (r.ok ? (r.json() as Promise<{ bars: ChartBar[] }>) : null))
      .then((j) => {
        if (!cancelled && j?.bars) setBars(j.bars);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [position?.id, position?.ticker]);

  const meta = position
    ? XSTOCKS[xStockToBare(position.ticker as XStockTicker)]
    : null;

  const computed = useMemo(() => {
    if (!position) return null;
    const value = position.tokenAmount * position.markPrice;
    const unrealized = (position.markPrice - position.entryPrice) * position.tokenAmount;
    const unrealizedPct =
      position.entryPrice > 0
        ? ((position.markPrice - position.entryPrice) / position.entryPrice) * 100
        : 0;
    const days = Math.max(
      0,
      Math.floor((Date.now() - new Date(position.firstEntryAt).getTime()) / (24 * 3600 * 1000)),
    );
    const drawdownFromPeak =
      position.markPrice >= position.entryPrice
        ? 0
        : ((position.markPrice - position.entryPrice) / position.entryPrice) * 100;
    return { value, unrealized, unrealizedPct, days, drawdownFromPeak };
  }, [position]);

  if (!position) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
        <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
          ← Home
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '16px 0' }}>Position not found</h1>
        <p style={{ color: 'var(--color-fg-muted)' }}>
          This position has been closed or doesn't exist on this device.
        </p>
      </main>
    );
  }

  const markerColor = '#22c55e';
  const stateBadge =
    position.state === 'ACTIVE'
      ? { bg: 'rgba(34,197,94,0.18)', fg: 'var(--color-buy)', label: 'Active' }
      : position.state === 'BUY_PENDING'
        ? { bg: 'rgba(245,158,11,0.18)', fg: 'var(--color-warn)', label: 'Buy pending' }
        : position.state === 'ENTERING'
          ? { bg: 'rgba(245,158,11,0.18)', fg: 'var(--color-warn)', label: 'Entering' }
          : position.state === 'CLOSING'
            ? { bg: 'rgba(245,158,11,0.18)', fg: 'var(--color-warn)', label: 'Closing' }
            : { bg: 'rgba(144,153,173,0.18)', fg: 'var(--color-fg-muted)', label: 'Closed' };

  async function submitTpSl() {
    if (!position) return;
    const tp = tpDraft === '' ? null : Number(tpDraft);
    const sl = slDraft === '' ? null : Number(slDraft);
    if (tp != null && (!Number.isFinite(tp) || tp <= 0)) {
      toast.error('TP must be a positive number');
      return;
    }
    if (sl != null && (!Number.isFinite(sl) || sl <= 0)) {
      toast.error('SL must be a positive number');
      return;
    }
    setBusy(true);
    try {
      if (!demo) {
        // Live: cancel the existing TP + SL trigger orders, then re-place at
        // the new prices. Jupiter Trigger Order v2 has no "edit in place" so
        // we have to round-trip cancel + place. A nullable price means
        // "remove that leg" — skip placing it.
        if (!meta || !meta.mint) {
          toast.error(`${position.ticker} mint not configured.`);
          return;
        }
        await cancelSiblingOrders();
        if (tp != null) {
          await placeSellExit({
            inputMint: meta.mint,
            inputDecimals: meta.decimals,
            tokenAmount: position.tokenAmount,
            triggerPriceUsd: tp,
            triggerCondition: 'above',
          });
        }
        if (sl != null) {
          await placeSellExit({
            inputMint: meta.mint,
            inputDecimals: meta.decimals,
            tokenAmount: position.tokenAmount,
            triggerPriceUsd: sl,
            triggerCondition: 'below',
          });
        }
        adjustTpSl(position.id, tp, sl); // mirror in client store for instant UI
        toast.success('TP / SL re-placed.');
        return;
      }
      adjustTpSl(position.id, tp, sl);
      toast.success('TP / SL updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doClose() {
    if (!position) return;
    setBusy(true);
    try {
      if (!demo) {
        if (!meta || !meta.mint) {
          toast.error(`${position.ticker} mint not configured.`);
          return;
        }
        // Live close: cancel both exit orders (so vault funds return to the
        // wallet), then market-sell the full xStock balance via Jupiter Ultra.
        await cancelSiblingOrders();
        const sell = await swap({
          direction: 'SELL',
          xStockMint: meta.mint,
          xStockDecimals: meta.decimals,
          sellAll: true,
        });
        // Persist the close on the server so the Position row flips state +
        // realizedPnl is recorded. The route now accepts {executionPrice,
        // tokenAmount, txSignature} so the demo branch + live branch share a
        // shape.
        const tokenAmt = Number(sell.inputAmount) / 10 ** meta.decimals;
        const usdOut = Number(sell.outputAmount) / 1_000_000;
        const executionPrice = tokenAmt > 0 ? usdOut / tokenAmt : position.markPrice;
        await fetch(`/api/positions/${position.id}/close`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            executionPrice,
            tokenAmount: tokenAmt,
            txSignature: sell.exec.signature ?? null,
          }),
        }).catch(() => {});
      }
      closePosition(position.id, 'USER_CLOSE', position.markPrice);
      toast.success(`${position.ticker} closed.`);
      router.replace('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginTop: 16, marginBottom: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {position.ticker}
          </h1>
          <span
            style={{
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              background: stateBadge.bg,
              color: stateBadge.fg,
            }}
          >
            {stateBadge.label}
          </span>
        </div>
        <div style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginTop: 4 }}>
          {meta?.name ?? '—'}
        </div>
      </motion.div>

      {/* Banner: Place exit orders (state=ENTERING) */}
      {position.state === 'ENTERING' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
          style={{
            background:
              'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.04))',
            border: '1px solid rgba(245,158,11,0.45)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  color: 'var(--color-warn)',
                  marginBottom: 4,
                }}
              >
                BUY FILLED · ACTION REQUIRED
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                Place exit orders to activate TP / SL protection
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
                Your BUY filled at ${position.entryPrice.toFixed(2)}. Confirm below to attach
                a take-profit at <strong style={{ color: 'var(--color-buy)' }}>
                  ${(position.currentTpPrice ?? 0).toFixed(2)}
                </strong>{' '}
                and a stop-loss at{' '}
                <strong style={{ color: 'var(--color-sell)' }}>
                  ${(position.currentSlPrice ?? 0).toFixed(2)}
                </strong>{' '}
                — each runs as its own Jupiter trigger order.
              </div>
            </div>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (demo) {
                    await new Promise((r) => setTimeout(r, 700));
                    confirmExitOrders(position.id);
                    toast.success('TP / SL trigger orders placed.');
                    return;
                  }

                  // Live: place TP and SL as two separate Jupiter trigger orders.
                  if (!meta || !meta.mint) {
                    toast.error(`${position.ticker} mint not configured.`);
                    return;
                  }
                  if (!position.currentTpPrice || !position.currentSlPrice) {
                    toast.error('TP / SL prices missing.');
                    return;
                  }
                  // Each leg = half the token amount (caller can split as desired).
                  const legAmount = position.tokenAmount;
                  const tp = await placeSellExit({
                    inputMint: meta.mint,
                    inputDecimals: meta.decimals,
                    tokenAmount: legAmount,
                    triggerPriceUsd: position.currentTpPrice,
                    triggerCondition: 'above',
                  });
                  const sl = await placeSellExit({
                    inputMint: meta.mint,
                    inputDecimals: meta.decimals,
                    tokenAmount: legAmount,
                    triggerPriceUsd: position.currentSlPrice,
                    triggerCondition: 'below',
                  });
                  toast.success(
                    `TP ${tp.id.slice(0, 6)} + SL ${sl.id.slice(0, 6)} placed.`,
                  );
                  // Persist via /api/orders happens in the calling page; for v1.3
                  // demo the live wiring is best-effort and the Order Tracker
                  // will reconcile state.
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Placing…' : 'Confirm exit orders'}
            </button>
          </div>
        </motion.div>
      )}

      {/* Banner: cancel sibling after TP/SL fill */}
      {position.state === 'CLOSED' && cancelSiblingHint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
          style={{
            background:
              'linear-gradient(135deg, rgba(124,92,255,0.18), rgba(124,92,255,0.04))',
            border: '1px solid rgba(124,92,255,0.45)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  color: 'var(--color-accent-strong)',
                  marginBottom: 4,
                }}
              >
                {position.closedReason === 'TP_FILLED' ? 'TP FILLED' : 'SL FILLED'} · WITHDRAW
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                Cancel the remaining {cancelSiblingHint.siblingKind} order
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
                Your {position.closedReason === 'TP_FILLED' ? 'take-profit' : 'stop-loss'} has
                filled. The other leg is still parked in Jupiter's vault — sign once to
                cancel it and pull the remaining funds back to your wallet.
              </div>
            </div>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (demo) {
                    await new Promise((r) => setTimeout(r, 600));
                    dismissCancelSibling(position.id);
                    toast.success('Vault funds withdrawn.');
                    return;
                  }
                  // Live: Phase F surfaces the sibling order id via the
                  // position:updated event payload. We only have the demo
                  // hint locally, so fetch the open SELL Order on this
                  // position and pass its jupiterOrderId to the cancel flow.
                  const ordersRes = await fetch(`/api/orders?wallet=${address ?? ''}`);
                  const j = (await ordersRes.json().catch(() => ({}))) as {
                    orders?: Array<{
                      id: string;
                      positionId: string;
                      kind: string;
                      jupiterOrderId: string | null;
                    }>;
                  };
                  const sibling = (j.orders ?? []).find(
                    (o) => o.positionId === position.id && o.kind !== 'BUY_TRIGGER',
                  );
                  if (!sibling?.jupiterOrderId) {
                    toast.error('No open sibling order found to cancel.');
                    dismissCancelSibling(position.id);
                    return;
                  }
                  const result = await cancelTrigger(sibling.jupiterOrderId);
                  await fetch(`/api/orders/${sibling.id}/cancel`, { method: 'POST' });
                  dismissCancelSibling(position.id);
                  toast.success(`Vault withdrawn: ${result.txSignature.slice(0, 8)}…`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Cancelling…' : 'Sign & withdraw'}
            </button>
          </div>
        </motion.div>
      )}

      {/* Chart with annotations */}
      {bars.length > 0 && (
        <div
          className="card"
          style={{ padding: '8px 6px 4px', marginBottom: 16 }}
        >
          <MiniChart
            bars={bars}
            height={180}
            marker={{
              price: position.entryPrice,
              label: 'entry',
              color: markerColor,
            }}
          />
        </div>
      )}

      {/* Position info */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Position</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Stat label="Quantity" value={`${position.tokenAmount.toFixed(4)} ${position.ticker}`} />
          <Stat label="Entry price" value={`$${position.entryPrice.toFixed(2)}`} />
          <Stat label="Mark price" value={`$${position.markPrice.toFixed(2)}`} />
          <Stat label="Value" value={`$${computed!.value.toFixed(2)}`} />
          <Stat
            label="Unrealised P&L"
            value={`${computed!.unrealized >= 0 ? '+' : ''}$${computed!.unrealized.toFixed(2)} (${computed!.unrealizedPct.toFixed(1)}%)`}
            color={computed!.unrealized >= 0 ? 'var(--color-buy)' : 'var(--color-sell)'}
          />
          <Stat label="Days held" value={`${computed!.days}`} />
          <Stat
            label="Take profit"
            value={position.currentTpPrice ? `$${position.currentTpPrice.toFixed(2)}` : '—'}
            color="var(--color-buy)"
          />
          <Stat
            label="Stop loss"
            value={position.currentSlPrice ? `$${position.currentSlPrice.toFixed(2)}` : '—'}
            color="var(--color-sell)"
          />
        </div>
      </div>

      {/* Adjust TP / SL */}
      {position.state === 'ACTIVE' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Adjust TP / SL</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <NumField label="Take profit" value={tpDraft} onChange={setTpDraft} color="var(--color-buy)" />
            <NumField label="Stop loss" value={slDraft} onChange={setSlDraft} color="var(--color-sell)" />
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submitTpSl()}
            >
              Update
            </button>
          </div>
        </div>
      )}

      {/* Stock intro */}
      {meta && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>About</h2>
          <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, lineHeight: 1.6 }}>
            {position.ticker} is the on-chain representation of {meta.name} on Solana. Trades
            against USDC via Jupiter; underlying exposure is held by the issuer.
          </p>
        </div>
      )}

      {/* Demo: simulate exit fills (only in demo mode + ACTIVE) */}
      {demo && position.state === 'ACTIVE' && (
        <div
          className="card"
          style={{
            background: 'rgba(245,158,11,0.06)',
            border: '1px dashed rgba(245,158,11,0.35)',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--color-warn)', marginBottom: 8 }}>
            DEMO ONLY · SIMULATE OCO FILL
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn btn-buy"
              style={{ flex: 1 }}
              onClick={() => {
                simulateExitFill(position.id, 'TP');
                toast.success('TP filled (simulated). SL cancel banner queued.');
              }}
            >
              Simulate TP fill
            </button>
            <button
              className="btn btn-sell"
              style={{ flex: 1 }}
              onClick={() => {
                simulateExitFill(position.id, 'SL');
                toast('SL filled (simulated). TP cancel banner queued.');
              }}
            >
              Simulate SL fill
            </button>
          </div>
        </div>
      )}

      {/* Close Position */}
      {position.state === 'ACTIVE' && (
        <div className="card">
          {!confirmClose ? (
            <button
              className="btn btn-sell"
              style={{ width: '100%', padding: '14px 24px', fontSize: 15 }}
              onClick={() => setConfirmClose(true)}
            >
              Close position
            </button>
          ) : (
            <div>
              <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginBottom: 12 }}>
                Cancel both exit orders and sell the full position at market price?
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setConfirmClose(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-sell"
                  style={{ flex: 2 }}
                  onClick={() => void doClose()}
                  disabled={busy}
                >
                  {busy ? 'Closing…' : 'Confirm close'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {position.state === 'CLOSED' && (
        <div className="card" style={{ background: 'var(--color-bg-muted)' }}>
          <div style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
            Closed via {position.closedReason ?? '—'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
            Realised P&L:{' '}
            <span
              style={{
                color:
                  (position.realizedPnl ?? 0) >= 0 ? 'var(--color-buy)' : 'var(--color-sell)',
              }}
            >
              {(position.realizedPnl ?? 0) >= 0 ? '+' : ''}$
              {(position.realizedPnl ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color ?? 'var(--color-fg)' }}>{value}</div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  color?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: color ?? 'var(--color-fg-muted)' }}>{label}</span>
      <input
        type="number"
        value={value}
        step={0.5}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: 10,
          borderRadius: 8,
          background: 'var(--color-bg-muted)',
          color: 'var(--color-fg)',
          border: '1px solid var(--color-border)',
        }}
      />
    </label>
  );
}
