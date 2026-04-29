'use client';

import { motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { isDemo } from '@/lib/demo';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import { useWallet } from '@/lib/wallet/use-wallet';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';
import { useExitOrders } from '@/lib/jupiter/use-exit-orders';
import { useRuntime } from '@/lib/runtime/use-runtime';
import { PositionStats } from '@/components/positions/position-stats';
import { CancelSiblingBanner, EnterBanner } from '@/components/positions/banners';
import { AdjustTpSlForm } from '@/components/positions/adjust-tpsl-form';
import { ClosedSummary, CloseButton } from '@/components/positions/close-button';
import { DemoSimulator } from '@/components/positions/demo-simulator';

const STATE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: 'bg-positive/20', text: 'text-positive', label: 'Active' },
  BUY_PENDING: { bg: 'bg-accent/30', text: 'text-on-surface', label: 'Buy pending' },
  ENTERING: { bg: 'bg-accent/30', text: 'text-on-surface', label: 'Entering' },
  CLOSING: { bg: 'bg-negative/20', text: 'text-negative', label: 'Closing' },
  CLOSED: { bg: 'bg-surface-container', text: 'text-on-surface-variant', label: 'Closed' },
};

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
  const { cancelExits, placeExit, replaceExits } = useExitOrders();
  const runtime = useRuntime();
  const { address: _address } = useWallet();
  void _address;

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

  const meta = position ? XSTOCKS[xStockToBare(position.ticker as XStockTicker)] : null;

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
      <>
        <TopAppBar
          title="Position"
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
        <main className="px-5 py-8 max-w-md mx-auto pb-24">
          <div className="bg-surface rounded-lg p-6 shadow-soft text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-surface-container flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-on-surface-variant text-[24px]">help</span>
            </div>
            <p className="text-title-md text-primary">Position not found</p>
            <p className="text-body-sm text-on-surface-variant mt-1">
              This position has been closed or doesn't exist on this device.
            </p>
          </div>
        </main>
      </>
    );
  }

  const badge = STATE_BADGE[position.state] ?? STATE_BADGE.CLOSED!;
  const pnlPositive = (computed?.unrealized ?? 0) >= 0;

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
      if (!meta || !meta.mint) {
        toast.error(`${position.ticker} mint not configured.`);
        return;
      }
      await runtime.closePosition({
        positionId: position.id,
        meta: { mint: meta.mint, decimals: meta.decimals },
        fallbackMarkPrice: position.markPrice,
      });
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
    <>
      <TopAppBar
        title="Position"
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

      <main className="px-5 py-6 pb-32 max-w-md mx-auto flex flex-col gap-6">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface rounded-lg p-5 shadow-soft flex flex-col items-center text-center"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-surface-dim flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[24px]">memory</span>
            </div>
            <span className={`px-3 py-1 rounded-full text-label-md font-semibold ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
          </div>
          <h1 className="text-display-lg text-on-background">{position.ticker}</h1>
          <div className="text-body-md text-on-surface-variant mt-1">{meta?.name ?? '—'}</div>
          <div className="text-number-xl text-on-background mt-3 tabular-nums">
            ${position.markPrice.toFixed(2)}
          </div>
          {computed && position.state !== 'CLOSED' && (
            <div
              className={`mt-3 px-3 py-1 rounded-full text-label-sm font-semibold ${
                pnlPositive ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'
              }`}
            >
              {pnlPositive ? '+' : ''}${computed.unrealized.toFixed(2)} ({pnlPositive ? '+' : ''}
              {computed.unrealizedPct.toFixed(1)}%)
            </div>
          )}
          {position.state === 'CLOSED' && position.realizedPnl != null && (
            <div
              className={`mt-3 px-3 py-1 rounded-full text-label-sm font-semibold ${
                position.realizedPnl >= 0 ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'
              }`}
            >
              Realized: {position.realizedPnl >= 0 ? '+' : ''}${position.realizedPnl.toFixed(2)}
            </div>
          )}
        </motion.section>

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
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-surface rounded-lg p-5 shadow-soft">
            <h3 className="text-title-lg text-on-surface mb-3">Price history</h3>
            <MiniChart
              bars={bars}
              height={180}
              marker={{ price: position.entryPrice, label: 'entry', color: '#22c55e' }}
              extraMarkers={[
                ...(position.currentTpPrice
                  ? [{ price: position.currentTpPrice, label: 'TP', color: '#22c55e' }]
                  : []),
                ...(position.currentSlPrice
                  ? [{ price: position.currentSlPrice, label: 'SL', color: '#ef4444' }]
                  : []),
              ]}
            />
          </motion.div>
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
          <div className="bg-surface rounded-lg p-5 shadow-soft">
            <h3 className="text-title-lg text-on-surface mb-2">About</h3>
            <p className="text-body-md text-on-surface-variant leading-relaxed">
              {position.ticker} is the on-chain representation of {meta.name} on Solana. Trades against USDC via Jupiter; underlying exposure is held by the issuer.
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
    </>
  );
}
