'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  DEMO_FAKE_MINT,
  SKIP_REASON_LABELS,
  XSTOCKS,
  xStockToBare,
  type DemoProposalShape,
  type SkipReason,
  type XStockTicker,
} from '@hunch-it/shared';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import { type ChartBar } from '@/components/charts/mini-chart';
import { usePersistOrder, useSkipProposal } from '@/lib/hooks/mutations';
import { usePortfolio } from '@/lib/hooks/queries';
import { fmtUsd, num } from '@/lib/utils/fmt';
import { ProposalHeader } from './proposal-header';
import { ProposalForm } from './proposal-form';
import { SkipFlow } from './skip-flow';
import { SellProposalView } from './sell-proposal-view';

type ProposalUI = DemoProposalShape;

interface ProposalModalProps {
  proposal: ProposalUI | null;
  fallbackId?: string;
  onClose: (decision: 'placed' | 'skipped' | null) => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(5, 6, 10, 0.72)',
  backdropFilter: 'blur(6px)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 9999,
  padding: 24,
};

export function ProposalModal({ proposal, fallbackId, onClose }: ProposalModalProps) {
  const { publicKey } = useWallet();
  const router = useRouter();
  const addPosition = useDemoPositionsStore((s) => s.addFromProposal);
  const persistOrder = usePersistOrder();
  const skipProposal = useSkipProposal();
  // cashUsd is the user's USDC balance read by /api/portfolio. We use it
  // pre-flight on the Approve button so the user sees "Insufficient USDC"
  // before paying for a Privy signature, instead of after Jupiter rejects.
  const portfolioQuery = usePortfolio();
  const cashUsd = portfolioQuery.data?.cashUsd ?? 0;
  const [bars, setBars] = useState<ChartBar[]>([]);
  const [executing, setExecuting] = useState(false);
  const [swapLoading, setSwapLoading] = useState<'order' | 'sign' | 'execute' | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState<SkipReason>('TOO_RISKY');
  const [skipDetail, setSkipDetail] = useState('');

  const [size, setSize] = useState<number>(0);
  const [trigger, setTrigger] = useState<number>(0);
  const [tp, setTp] = useState<number>(0);
  const [sl, setSl] = useState<number>(0);

  useEffect(() => {
    if (!proposal) return;
    setSize(proposal.suggestedSizeUsd);
    setTrigger(proposal.suggestedTriggerPrice);
    setTp(proposal.suggestedTakeProfitPrice);
    setSl(proposal.suggestedStopLossPrice);
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
  }, [proposal?.id, proposal?.ticker]);

  const exitTtl = useMemo(() => {
    if (!proposal) return null;
    const remainMs = new Date(proposal.expiresAt).getTime() - Date.now();
    if (remainMs <= 0) return 'Expired';
    const m = Math.floor(remainMs / 60_000);
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  }, [proposal?.expiresAt]);

  if (!proposal) {
    return (
      <motion.div
        style={overlayStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      >
        <motion.div
          className="card"
          style={{ maxWidth: 420 }}
          initial={{ scale: 0.94, y: 12, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Proposal not found</h2>
          <p style={{ color: 'var(--color-fg-muted)', marginBottom: 16 }}>
            {fallbackId ? (
              <>
                This proposal has expired or wasn't received by this tab:{' '}
                <code style={{ fontSize: 12 }}>{fallbackId}</code>.
              </>
            ) : (
              <>No proposal id provided.</>
            )}
          </p>
          <button className="btn btn-ghost" onClick={() => onClose(null)}>
            Close
          </button>
        </motion.div>
      </motion.div>
    );
  }

  // Branch on action: SELL has its own thinner view (no size/trigger edit
  // because the user already holds the position).
  if (proposal.action === 'SELL') {
    return (
      <motion.div
        style={overlayStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <SellProposalView proposal={proposal} onClose={onClose} />
      </motion.div>
    );
  }

  const meta = XSTOCKS[xStockToBare(proposal.ticker as XStockTicker)];
  const demo = isDemo();
  const walletKey = publicKey?.toBase58() ?? (demo ? 'demo-wallet' : null);
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function handlePlace() {
    if (!walletKey) {
      toast.error('Connect a wallet to place orders.');
      return;
    }
    if (!meta) {
      toast.error(`Unknown ticker ${proposal!.ticker}`);
      return;
    }
    const mintForSwap = meta.mint || (demo ? DEMO_FAKE_MINT : '');
    if (!mintForSwap) {
      toast.error(
        `${meta.symbol} mint is empty — run \`pnpm --filter @hunch-it/ws-server verify:xstocks\`.`,
      );
      return;
    }

    setExecuting(true);
    try {
      if (demo) {
        setSwapLoading('order');
        await sleep(600);
        setSwapLoading('sign');
        await sleep(900);
        setSwapLoading('execute');
        await sleep(700);
        setSwapLoading(null);

        const position = addPosition({
          proposalId: proposal!.id,
          ticker: proposal!.ticker,
          sizeUsd: size,
          entryPrice: trigger,
          tpPrice: tp,
          slPrice: sl,
        });
        toast.success(`BUY ${proposal!.ticker} placed (demo). TP/SL attached on fill.`, {
          action: {
            label: 'View position',
            onClick: () => router.push(`/positions/${position.id}`),
          },
        });
        onClose('placed');
        return;
      }

      // xStocks aren't on Jupiter Trigger v2's allowlist (Backed Finance
      // tokens, traded only on a few Solana DEXs Jupiter Ultra aggregates).
      // So we don't deposit into Jupiter's vault on Approve — instead we
      // record an intent in our DB. The ws-server price monitor watches
      // Pyth for the trigger condition; when it hits, we push a socket
      // event to the user's desk and they tap-to-execute via Jupiter
      // Ultra (see use-jupiter-swap). Future: server-side delegated
      // signer auto-executes when Privy Pro is enabled.
      const persistJson = await persistOrder.mutateAsync({
        walletAddress: walletKey,
        proposalId: proposal!.id,
        ticker: proposal!.ticker,
        kind: 'BUY_TRIGGER',
        side: 'BUY',
        triggerPriceUsd: trigger,
        sizeUsd: size,
        // No jupiterOrderId — this is a synthetic / off-chain trigger,
        // not a Jupiter Trigger v2 order.
        jupiterOrderId: null,
        txSignature: null,
        slippageBps: 50,
        createPosition: {
          mint: meta.mint,
          entryPriceEstimate: trigger,
          tpPrice: tp,
          slPrice: sl,
        },
      });

      toast.success(
        `BUY ${proposal!.ticker} watching for $${trigger.toFixed(2)}. We'll ping you when price hits.`,
        {
          action: persistJson.positionId
            ? {
                label: 'View position',
                onClick: () => router.push(`/positions/${persistJson.positionId}`),
              }
            : undefined,
        },
      );
      onClose('placed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  async function handleSkip() {
    if (!walletKey) {
      toast.error('Connect a wallet first.');
      return;
    }
    if (!demo) {
      void skipProposal
        .mutateAsync({
          proposalId: proposal!.id,
          reason: skipReason,
          detail: skipReason === 'OTHER' ? skipDetail : undefined,
        })
        .catch(() => {});
    }
    toast(`Proposal skipped (${SKIP_REASON_LABELS[skipReason] ?? skipReason})`);
    onClose('skipped');
  }

  return (
    <motion.div
      style={overlayStyle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="card"
        style={{
          width: 'min(720px, 94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '28px 32px 24px',
          boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
        }}
        initial={{ scale: 0.94, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      >
        <ProposalHeader
          proposal={proposal}
          metaName={meta?.name}
          exitTtl={exitTtl}
          bars={bars}
        />

        <ProposalForm
          size={size}
          trigger={trigger}
          tp={tp}
          sl={sl}
          onSize={setSize}
          onTrigger={setTrigger}
          onTp={setTp}
          onSl={setSl}
        />

        {!skipOpen ? (
          <>
            {(() => {
              // Demo + portfolio-still-loading states bypass the gate so the
              // button stays clickable. We only block on a confirmed
              // shortfall.
              const portfolioReady = !portfolioQuery.isLoading;
              const sizeNum = num(size);
              const cashNum = num(cashUsd);
              const insufficient = !isDemo() && portfolioReady && sizeNum > cashNum;
              return (
                <>
                  {insufficient && (
                    <div className="mb-3 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-body-sm text-negative">
                      Insufficient USDC. You have {fmtUsd(cashNum)}, this order needs {fmtUsd(sizeNum)}.{' '}
                      <a
                        href="/desk#deposit-section"
                        onClick={() => onClose(null)}
                        className="underline font-semibold"
                      >
                        Deposit
                      </a>
                      .
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      className="btn btn-ghost"
                      style={{ flex: 1, padding: '14px 24px', fontSize: 15 }}
                      disabled={executing}
                      onClick={() => setSkipOpen(true)}
                    >
                      Skip
                    </button>
                    <button
                      className="btn btn-buy"
                      style={{ flex: 2, padding: '14px 24px', fontSize: 15 }}
                      disabled={executing || size <= 0 || insufficient}
                      onClick={() => void handlePlace()}
                    >
                      {executing
                        ? swapLoading === 'sign'
                          ? 'Awaiting signature…'
                          : swapLoading === 'execute'
                            ? 'Submitting order…'
                            : swapLoading === 'order'
                              ? 'Quoting…'
                              : 'Placing…'
                        : insufficient
                          ? 'Insufficient USDC'
                          : 'Place trigger order'}
                    </button>
                  </div>
                </>
              );
            })()}
          </>
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
    </motion.div>
  );
}
