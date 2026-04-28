'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { isDemo } from '@/lib/demo';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import { useWallet } from '@/lib/wallet/use-wallet';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';
import { useJupiterSwap } from '@/lib/jupiter/use-jupiter-swap';
import { useExitOrders } from '@/lib/jupiter/use-exit-orders';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { PositionStats } from '@/components/positions/position-stats';
import { CancelSiblingBanner, EnterBanner } from '@/components/positions/banners';
import { AdjustTpSlForm } from '@/components/positions/adjust-tpsl-form';
import { ClosedSummary, CloseButton } from '@/components/positions/close-button';
import { DemoSimulator } from '@/components/positions/demo-simulator';

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
  const { swap } = useJupiterSwap();
  const { cancelExits, placeExit, replaceExits } = useExitOrders();
  const { address: _address } = useWallet();
  void _address;
  const authedFetch = useAuthedFetch();

  const [bars, setBars] = useState<ChartBar[]>([]);
  const [tpDraft, setTpDraft] = useState('');
  const [slDraft, setSlDraft] = useState('');
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
    return { value, unrealized, unrealizedPct, days };
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

  // Cancel + re-place + rollback flows are owned by useExitOrders() so the
  // SellProposalView and Settings panic-close share the same logic.

  async function handleConfirmExit() {
    setBusy(true);
    try {
      if (demo) {
        await new Promise((r) => setTimeout(r, 700));
        confirmExitOrders(position!.id);
        toast.success('TP / SL trigger orders placed.');
        return;
      }
      if (!meta || !meta.mint) {
        toast.error(`${position!.ticker} mint not configured.`);
        return;
      }
      if (!position!.currentTpPrice || !position!.currentSlPrice) {
        toast.error('TP / SL prices missing.');
        return;
      }
      const legAmount = position!.tokenAmount;
      const tp = await placeExit({
        inputMint: meta.mint,
        inputDecimals: meta.decimals,
        tokenAmount: legAmount,
        triggerPriceUsd: position!.currentTpPrice,
        triggerCondition: 'above',
      });
      const sl = await placeExit({
        inputMint: meta.mint,
        inputDecimals: meta.decimals,
        tokenAmount: legAmount,
        triggerPriceUsd: position!.currentSlPrice,
        triggerCondition: 'below',
      });
      toast.success(`TP ${tp.id.slice(0, 6)} + SL ${sl.id.slice(0, 6)} placed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    setBusy(true);
    try {
      if (demo) {
        await new Promise((r) => setTimeout(r, 600));
        dismissCancelSibling(position!.id);
        toast.success('Vault funds withdrawn.');
        return;
      }
      const cancelled = await cancelExits(position!.id);
      dismissCancelSibling(position!.id);
      if (cancelled.length === 0) {
        toast('No open sibling order to cancel.');
      } else {
        toast.success(`Vault withdrawn (${cancelled.length} leg cancelled).`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitTpSl() {
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
        if (!meta || !meta.mint) {
          toast.error(`${position.ticker} mint not configured.`);
          return;
        }
        await replaceExits(
          position.id,
          { mint: meta.mint, decimals: meta.decimals },
          position.tokenAmount,
          [
            { kind: 'TAKE_PROFIT', triggerPriceUsd: tp },
            { kind: 'STOP_LOSS', triggerPriceUsd: sl },
          ],
        );
        adjustTpSl(position.id, tp, sl);
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

  async function handleClose() {
    if (!position) return;
    setBusy(true);
    try {
      if (!demo) {
        if (!meta || !meta.mint) {
          toast.error(`${position.ticker} mint not configured.`);
          return;
        }
        await cancelExits(position.id);
        const sell = await swap({
          direction: 'SELL',
          xStockMint: meta.mint,
          xStockDecimals: meta.decimals,
          sellAll: true,
        });
        const tokenAmt = Number(sell.inputAmount) / 10 ** meta.decimals;
        const usdOut = Number(sell.outputAmount) / 1_000_000;
        const executionPrice = tokenAmt > 0 ? usdOut / tokenAmt : position.markPrice;
        await authedFetch(`/api/positions/${position.id}/close`, {
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

      {position.state === 'ENTERING' && (
        <EnterBanner position={position} busy={busy} onConfirm={handleConfirmExit} />
      )}

      {position.state === 'CLOSED' && cancelSiblingHint && (
        <CancelSiblingBanner
          closedReason={position.closedReason ?? null}
          siblingKind={cancelSiblingHint.siblingKind}
          busy={busy}
          onWithdraw={handleWithdraw}
        />
      )}

      {bars.length > 0 && (
        <div className="card" style={{ padding: '8px 6px 4px', marginBottom: 16 }}>
          <MiniChart
            bars={bars}
            height={180}
            marker={{
              price: position.entryPrice,
              label: 'entry',
              color: '#22c55e',
            }}
            extraMarkers={[
              ...(position.currentTpPrice
                ? [{ price: position.currentTpPrice, label: 'TP', color: '#22c55e' }]
                : []),
              ...(position.currentSlPrice
                ? [{ price: position.currentSlPrice, label: 'SL', color: '#ef4444' }]
                : []),
            ]}
          />
        </div>
      )}

      <PositionStats position={position} computed={computed!} />

      {position.state === 'ACTIVE' && (
        <AdjustTpSlForm
          tpDraft={tpDraft}
          slDraft={slDraft}
          busy={busy}
          onTpChange={setTpDraft}
          onSlChange={setSlDraft}
          onSubmit={() => void handleSubmitTpSl()}
        />
      )}

      {meta && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>About</h2>
          <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, lineHeight: 1.6 }}>
            {position.ticker} is the on-chain representation of {meta.name} on Solana. Trades
            against USDC via Jupiter; underlying exposure is held by the issuer.
          </p>
        </div>
      )}

      {demo && position.state === 'ACTIVE' && (
        <DemoSimulator
          onSimTp={() => {
            simulateExitFill(position.id, 'TP');
            toast.success('TP filled (simulated). SL cancel banner queued.');
          }}
          onSimSl={() => {
            simulateExitFill(position.id, 'SL');
            toast('SL filled (simulated). TP cancel banner queued.');
          }}
        />
      )}

      {position.state === 'ACTIVE' && (
        <CloseButton busy={busy} onConfirm={() => void handleClose()} />
      )}

      {position.state === 'CLOSED' && (
        <ClosedSummary
          closedReason={position.closedReason ?? null}
          realizedPnl={position.realizedPnl ?? null}
        />
      )}
    </main>
  );
}
