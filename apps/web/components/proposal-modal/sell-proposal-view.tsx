'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  SKIP_REASON_LABELS,
  XSTOCKS,
  getThesisTag,
  xStockToBare,
  type DemoProposalShape,
  type SkipReason,
  type XStockTicker,
} from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useRuntime } from '@/lib/runtime/use-runtime';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import { isDemo } from '@/lib/demo';
import { useSkipProposal } from '@/lib/hooks/mutations';
import { usePosition } from '@/lib/hooks/queries';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';
import { SkipFlow } from './skip-flow';

interface SellProposalViewProps {
  proposal: DemoProposalShape;
  onClose: (decision: 'placed' | 'skipped' | null) => void;
}

/**
 * SELL Proposal modal — emitted by ws-server thesis-monitor when the
 * majority of a BUY's thesis tags have flipped false. The view is much
 * thinner than the BUY modal: there's no size / trigger / TP / SL to
 * edit because the user already holds the position. Two actions:
 *   - Skip: keep the position, mark Proposal SKIPPED
 *   - Confirm sell: cancel any open exit orders + market-sell via
 *     Jupiter Ultra + POST /api/proposals/[id]/sell-confirm
 */
export function SellProposalView({ proposal, onClose }: SellProposalViewProps) {
  const router = useRouter();
  const { address: _address } = useWallet();
  void _address;
  const demo = isDemo();
  const closeDemoPosition = useDemoPositionsStore((s) => s.closePosition);
  const demoPosition = useDemoPositionsStore((s) =>
    proposal.positionId ? s.positions.find((p) => p.id === proposal.positionId) ?? null : null,
  );
  // Live position used for accurate tokenAmount on the close — without
  // this the swap falls back to sellAll and would sweep dust / siblings
  // sharing the same mint.
  const livePositionQuery = usePosition(proposal.positionId ?? undefined);
  const runtime = useRuntime();
  const skipProposal = useSkipProposal();

  const [bars, setBars] = useState<ChartBar[]>([]);
  const [executing, setExecuting] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState<SkipReason>('DISAGREE_THESIS');
  const [skipDetail, setSkipDetail] = useState('');

  useEffect(() => {
    let cancelled = false;
    const bare = xStockToBare(proposal.ticker as XStockTicker);
    fetch(`/api/bars/${bare}?resolution=5&hours=24`)
      .then((r) => (r.ok ? (r.json() as Promise<{ bars: ChartBar[] }>) : null))
      .then((j) => {
        if (!cancelled && j?.bars) setBars(j.bars);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [proposal.ticker]);

  const exitTtl = useMemo(() => {
    const remainMs = new Date(proposal.expiresAt).getTime() - Date.now();
    if (remainMs <= 0) return 'Expired';
    const m = Math.floor(remainMs / 60_000);
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  }, [proposal.expiresAt]);

  const meta = XSTOCKS[xStockToBare(proposal.ticker as XStockTicker)];
  const invalidatedTagIds = (proposal.thesisTags ?? []) as string[];

  async function handleConfirmSell() {
    if (!proposal.positionId) {
      toast.error('SELL proposal missing positionId');
      return;
    }
    setExecuting(true);
    try {
      if (!meta?.mint) {
        toast.error(`${proposal.ticker} mint not configured.`);
        return;
      }
      const tokenAmount = demo
        ? demoPosition?.tokenAmount ?? null
        : livePositionQuery.data?.tokenAmount ?? null;
      const result = await runtime.closePosition({
        positionId: proposal.positionId,
        meta: { mint: meta.mint, decimals: meta.decimals },
        fallbackMarkPrice: demoPosition?.markPrice ?? proposal.priceAtProposal,
        tokenAmount,
        // Routes the persistence step through the SELL Proposal endpoint
        // so the Trade row carries proposalId + Proposal flips EXECUTED.
        sellProposalId: proposal.id,
      });
      // Mirror in the demo store so demo mode UI updates instantly.
      if (demo && demoPosition) {
        closeDemoPosition(demoPosition.id, 'USER_CLOSE', demoPosition.markPrice);
      }
      const sigSlice = result.txSignature ? `(${result.txSignature.slice(0, 8)}…)` : '';
      toast.success(`Sold ${proposal.ticker} ${sigSlice}`.trim(), {
        action: {
          label: 'View portfolio',
          onClick: () => router.push('/portfolio'),
        },
      });
      onClose('placed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  async function handleSkip() {
    if (!demo) {
      void skipProposal
        .mutateAsync({
          proposalId: proposal.id,
          reason: skipReason,
          detail: skipReason === 'OTHER' ? skipDetail : undefined,
        })
        .catch(() => {});
    }
    toast(`Kept ${proposal.ticker} (${SKIP_REASON_LABELS[skipReason] ?? skipReason})`);
    onClose('skipped');
  }

  return (
    <motion.div
      className="card"
      style={{
        width: 'min(640px, 94vw)',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '28px 32px 24px',
        boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
        border: '1px solid rgba(239,68,68,0.45)',
      }}
      initial={{ scale: 0.94, y: 24, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-sell)', letterSpacing: '0.06em' }}>
            THESIS INVALIDATED · CONSIDER SELL
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {proposal.ticker}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
            {meta?.name ?? '—'}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="badge badge-sell">SELL</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--color-fg-muted)' }}>Decide within</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{exitTtl}</div>
        </div>
      </div>

      {/* Rationale */}
      <div
        style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 10,
          padding: 14,
          fontSize: 14,
          marginBottom: 16,
          lineHeight: 1.5,
        }}
      >
        {proposal.rationale}
      </div>

      {/* Chart with current price marker */}
      {bars.length > 0 && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '8px 6px 4px', marginBottom: 16 }}>
          <MiniChart
            bars={bars}
            height={150}
            marker={{ price: proposal.priceAtProposal, label: 'now', color: '#ef4444' }}
          />
        </div>
      )}

      {/* Thesis tags — show which flipped */}
      {invalidatedTagIds.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-fg-muted)',
              marginBottom: 6,
            }}
          >
            Invalidated thesis conditions
          </div>
          <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            {invalidatedTagIds.map((id) => {
              const def = getThesisTag(id);
              const isTriggering = id === proposal.triggeringTag;
              return (
                <li
                  key={id}
                  style={{
                    fontSize: 13,
                    color: isTriggering ? 'var(--color-sell)' : 'var(--color-fg-muted)',
                    fontWeight: isTriggering ? 600 : 400,
                  }}
                >
                  <span style={{ textDecoration: 'line-through' }}>
                    {def?.label ?? id}
                  </span>
                  {isTriggering && ' ← triggered alert'}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Actions */}
      {!skipOpen ? (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1, padding: '14px 24px', fontSize: 15 }}
            disabled={executing}
            onClick={() => setSkipOpen(true)}
          >
            Keep position
          </button>
          <button
            className="btn btn-sell"
            style={{ flex: 2, padding: '14px 24px', fontSize: 15 }}
            disabled={executing}
            onClick={() => void handleConfirmSell()}
          >
            {executing ? 'Selling…' : `Sell ${proposal.ticker}`}
          </button>
        </div>
      ) : (
        <SkipFlow
          reason={skipReason}
          detail={skipDetail}
          onReason={setSkipReason}
          onDetail={setSkipDetail}
          onBack={() => setSkipOpen(false)}
          onSubmit={() => void handleSkip()}
        />
      )}
    </motion.div>
  );
}
