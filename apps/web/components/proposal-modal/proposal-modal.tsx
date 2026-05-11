'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  getAssetById,
  type Proposal,
  type SkipReason,
} from '@hunch-it/shared';
import { useRouter } from 'next/navigation';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWallet } from '@/lib/wallet/use-wallet';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';
import { usePersistOrder, useSkipProposal } from '@/lib/hooks/mutations';
import { usePortfolio } from '@/lib/hooks/queries';
import { useDeskGrowth } from '@/lib/desk-growth/use-desk-growth';
import { fmtPct, fmtUsd, num } from '@/lib/utils/fmt';
import { ProposalForm } from './proposal-form';
import { SkipFlow } from './skip-flow';
import { SellProposalView } from './sell-proposal-view';

type ProposalUI = Proposal;

interface ProposalModalProps {
  proposal: ProposalUI | null;
  fallbackId?: string;
  onBack: () => void;
  onDecision: (decision: 'placed' | 'skipped' | null) => void;
}

type ThesisItem = {
  icon: string;
  eyebrow: string;
  title: string;
  body: string;
  tone: 'accent' | 'secondary' | 'neutral';
};

const shortCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function ProposalModal({ proposal, fallbackId, onBack, onDecision }: ProposalModalProps) {
  const { publicKey } = useWallet();
  const router = useRouter();
  const persistOrder = usePersistOrder();
  const skipProposal = useSkipProposal();
  const portfolioQuery = usePortfolio();
  const {
    state: deskGrowthState,
    awardProposalReview,
    awardProposalSkip,
    awardProposalAccept,
  } = useDeskGrowth();
  const cashUsd = portfolioQuery.data?.cashUsd ?? 0;
  const [bars, setBars] = useState<ChartBar[]>([]);
  const [executing, setExecuting] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState<SkipReason | null>(null);
  const [skipDetail, setSkipDetail] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [size, setSize] = useState<number>(() => proposal?.suggestedSizeUsd ?? 0);
  const [trigger, setTrigger] = useState<number>(() => proposal?.suggestedTriggerPrice ?? 0);
  const [tp, setTp] = useState<number>(() => proposal?.suggestedTakeProfitPrice ?? 0);
  const [sl, setSl] = useState<number>(() => proposal?.suggestedStopLossPrice ?? 0);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!proposal) return;
    awardProposalReview(proposal.id);
    setSize(proposal.suggestedSizeUsd);
    setTrigger(proposal.suggestedTriggerPrice);
    setTp(proposal.suggestedTakeProfitPrice);
    setSl(proposal.suggestedStopLossPrice);
    setSkipOpen(false);
    setSkipReason(null);
    setSkipDetail('');
    let cancelled = false;
    fetch(`/api/bars/${encodeURIComponent(proposal.ticker)}?resolution=5&hours=24`)
      .then((r) => (r.ok ? (r.json() as Promise<{ bars: ChartBar[] }>) : null))
      .then((j) => {
        if (!cancelled && j?.bars) setBars(j.bars);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [awardProposalReview, proposal?.id, proposal?.ticker]);

  const remainMs = useMemo(() => {
    if (!proposal) return null;
    return new Date(proposal.expiresAt).getTime() - nowMs;
  }, [nowMs, proposal?.expiresAt]);

  const exitTtl = useMemo(() => {
    if (remainMs == null) return null;
    if (remainMs <= 0) return 'Expired';
    const m = Math.floor(remainMs / 60_000);
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  }, [remainMs]);

  if (!proposal) {
    return (
      <>
        <TopAppBar title="Proposal" leftAction={<BackIconButton onBack={onBack} />} />
        <main className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-md flex-col justify-center px-5 pb-24 pt-6">
          <section className="rounded-lg bg-surface p-5 text-center shadow-soft">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-container text-primary">
              <span className="material-symbols-outlined text-[24px]">search_off</span>
            </div>
            <h1 className="text-title-lg text-on-surface">Proposal not found</h1>
            <p className="mt-2 text-body-md text-on-surface-variant">
              {fallbackId
                ? 'This proposal may have expired, been skipped, or been opened from an old notification.'
                : 'No proposal id was provided.'}
            </p>
            {fallbackId && (
              <p className="mt-3 break-all rounded-md bg-surface-container px-3 py-2 font-mono text-body-sm text-on-surface-variant">
                {fallbackId}
              </p>
            )}
            <Button className="mt-5 w-full" variant="accent" onClick={onBack}>
              Back to desk
            </Button>
          </section>
        </main>
      </>
    );
  }

  if (proposal.action === 'SELL') {
    return (
      <>
        <TopAppBar title="Proposal" leftAction={<BackIconButton onBack={onBack} />} />
        <main className="mx-auto w-full max-w-md px-5 pb-28 pt-6">
          <SellProposalView proposal={proposal} onClose={onDecision} />
        </main>
      </>
    );
  }

  const meta = getAssetById(proposal.ticker);
  const walletKey = publicKey?.toBase58() ?? null;
  const portfolioReady = !portfolioQuery.isLoading;
  const sizeNum = num(size);
  const cashNum = num(cashUsd);
  const insufficient = portfolioReady && sizeNum > cashNum;
  const isExpired = remainMs != null && remainMs <= 0;
  const isReadOnly = proposal.status !== 'ACTIVE' || isExpired;
  const quantOwned = deskGrowthState.analysts.quant.owned;
  const skipNeedsDetail = skipReason === 'OTHER' && skipDetail.trim().length === 0;
  const orderDisabled = executing || isReadOnly || sizeNum <= 0 || insufficient;
  const skipConfirmDisabled = executing || isReadOnly || skipProposal.isPending || skipNeedsDetail;
  const skipConfirmLabel = skipProposal.isPending
    ? 'Skipping'
    : skipReason
      ? 'Save & skip'
      : 'Skip';

  const marketMoveItem: ThesisItem = {
    icon: 'trending_up',
    eyebrow: 'Market move',
    title: 'What moved',
    body: proposal.reasoning.what_changed,
    tone: 'accent',
  };

  const supportingThesisItems: ThesisItem[] = [
    {
      icon: 'route',
      eyebrow: 'Trade logic',
      title: 'Why enter here',
      body: proposal.reasoning.why_this_trade,
      tone: 'secondary',
    },
    {
      icon: 'rule',
      eyebrow: 'Mandate fit',
      title: 'Why it belongs',
      body: proposal.reasoning.why_fits_mandate,
      tone: 'neutral',
    },
  ];

  async function handlePlace() {
    if (!walletKey) {
      toast.error('Connect a wallet to place orders.');
      return;
    }
    if (!meta) {
      toast.error(`Unknown ticker ${proposal!.ticker}`);
      return;
    }
    if (!meta.mint) {
      toast.error(
        `${meta.displaySymbol} mint is empty. Check packages/shared/src/assets.ts.`,
      );
      return;
    }

    setExecuting(true);
    try {
      const persistJson = await persistOrder.mutateAsync({
        walletAddress: walletKey,
        proposalId: proposal!.id,
        ticker: proposal!.ticker,
        kind: 'BUY_TRIGGER',
        side: 'BUY',
        triggerPriceUsd: trigger,
        sizeUsd: size,
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
        `Watching ${proposal!.ticker} for ${fmtUsd(trigger)}. We will ping you when price hits.`,
        {
          action: persistJson.positionId
            ? {
                label: 'View position',
                onClick: () => router.push(`/positions/${persistJson.positionId}`),
              }
            : undefined,
        },
      );
      awardProposalAccept(proposal!.id);
      onDecision('placed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  async function handleSkip() {
    if (!walletKey) {
      toast.error('Connect a wallet to skip proposals.');
      return;
    }
    const skipArgs: { proposalId: string; reason?: SkipReason; detail?: string } = {
      proposalId: proposal!.id,
    };
    if (skipReason) {
      skipArgs.reason = skipReason;
      if (skipReason === 'OTHER') skipArgs.detail = skipDetail.trim();
    }
    try {
      await skipProposal.mutateAsync(skipArgs);
      awardProposalSkip(proposal!.id, Boolean(skipReason));
      onDecision('skipped');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCancelSkip() {
    setSkipOpen(false);
    setSkipReason(null);
    setSkipDetail('');
  }

  return (
    <>
      <TopAppBar title="Proposal" leftAction={<BackIconButton onBack={onBack} />} />

      <main className="mx-auto flex w-full max-w-md flex-col gap-[14px] px-5 pb-36 pt-4">
        {isReadOnly && (
          <div className="rounded-lg bg-tertiary-container px-4 py-3 text-body-sm text-on-tertiary-container">
            This proposal is no longer active. You can review it, but order submission is disabled.
          </div>
        )}

        <section
          className={`overflow-hidden rounded-lg p-5 shadow-soft ${
            quantOwned ? 'bg-primary text-on-primary' : 'bg-accent text-on-accent'
          }`}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <Badge
                  variant="default"
                  className={`border-transparent ${
                    quantOwned ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'
                  }`}
                >
                  {proposal.action}
                </Badge>
                <span
                  className={
                    quantOwned
                      ? 'text-label-md text-on-primary/75'
                      : 'text-label-md text-primary/75'
                  }
                >
                  {fmtPct(num(proposal.confidence), { digits: 0 })} confidence
                </span>
              </div>
              <h1
                className={
                  quantOwned
                    ? 'break-words text-number-xl text-on-primary'
                    : 'break-words text-number-xl text-primary'
                }
              >
                {proposal.ticker}
              </h1>
              <p
                className={
                  quantOwned
                    ? 'mt-1 text-body-md text-on-primary/75'
                    : 'mt-1 text-body-md text-primary/75'
                }
              >
                {meta?.name ?? 'Unknown asset'}
              </p>
            </div>
            <div
              className={`shrink-0 rounded-full px-3 py-2 text-right ${
                quantOwned ? 'bg-surface/10 text-on-primary' : 'bg-surface/70 text-primary'
              }`}
            >
              <div className="text-label-sm">Expires</div>
              <div className="font-mono text-title-md">{exitTtl ?? 'Unknown'}</div>
            </div>
          </div>
          <p
            className={
              quantOwned
                ? 'max-w-[68ch] text-body-md font-medium leading-6 text-on-primary'
                : 'max-w-[68ch] text-body-md font-medium leading-6 text-primary'
            }
          >
            {proposal.rationale}
          </p>
        </section>

        {bars.length > 0 && (
          <section className="rounded-lg bg-surface p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-title-md text-on-surface">Price path</h2>
              <span className="rounded-full bg-surface-container px-3 py-1 text-label-sm text-on-surface-variant">
                24h
              </span>
            </div>
            <MiniChart
              bars={bars}
              height={180}
              color="#1A1C1E"
              marker={{ price: trigger, label: 'Trigger', color: '#1A1C1E' }}
              extraMarkers={[
                { price: tp, label: 'TP', color: '#20BFC6' },
                { price: sl, label: 'SL', color: '#FF745D' },
              ]}
            />
          </section>
        )}

        <section
          className={
            quantOwned
              ? 'rounded-lg bg-surface-bright p-5 shadow-card ring-1 ring-primary/10'
              : 'rounded-lg bg-surface p-5 shadow-soft'
          }
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-title-md text-on-surface">Read the trade</h2>
            <span className="text-label-sm text-on-surface-variant">
              {quantOwned ? '3 checks' : '2 checks'}
            </span>
          </div>
          <div className="flex flex-col gap-4">
            {quantOwned ? <ThesisRow item={marketMoveItem} /> : <LockedMarketMoveRow />}
            {supportingThesisItems.map((item) => (
              <ThesisRow key={item.title} item={item} />
            ))}
          </div>
        </section>

        <section className="rounded-lg bg-surface p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-title-md text-on-surface">Portfolio impact</h2>
            <span className="material-symbols-outlined text-[20px] text-icon-muted">
              account_balance
            </span>
          </div>
          <ImpactRow
            label={`${proposal.ticker} weight`}
            before={fmtPct(num(proposal.positionImpact?.weight_before))}
            after={fmtPct(num(proposal.positionImpact?.weight_after))}
          />
          <ImpactRow
            label="Cash after order"
            before={fmtUsd(cashNum, { digits: 0 })}
            after={shortCurrency.format(num(proposal.positionImpact?.cash_after))}
            tone={num(proposal.positionImpact?.cash_after) < 0 ? 'negative' : 'neutral'}
          />
          <ImpactRow
            label="Sector exposure"
            before={fmtPct(num(proposal.positionImpact?.sector_before), { digits: 0 })}
            after={fmtPct(num(proposal.positionImpact?.sector_after), { digits: 0 })}
            last
          />
        </section>

        <section className="rounded-lg bg-surface p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-title-md text-on-surface">Order settings</h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Adjust size, entry, and protection before submitting.
              </p>
            </div>
            <span className="material-symbols-outlined text-[22px] text-icon-muted">tune</span>
          </div>
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
          {insufficient && (
            <div className="mt-4 rounded-lg bg-negative-container px-4 py-3 text-body-sm text-negative">
              Not enough USDC. You have {fmtUsd(cashNum)}, this order needs {fmtUsd(sizeNum)}.{' '}
              <a
                href="/desk#deposit-section"
                className="font-semibold underline underline-offset-2"
              >
                Deposit USDC
              </a>
              .
            </div>
          )}
        </section>

        {skipOpen && (
          <section className="rounded-lg bg-surface p-5 shadow-soft">
            <SkipFlow
              reason={skipReason}
              detail={skipDetail}
              onReason={setSkipReason}
              onDetail={setSkipDetail}
            />
          </section>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-50 border-t border-divider bg-background/95 px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {skipOpen ? (
          <div className="mx-auto grid w-full max-w-md grid-cols-[0.95fr_1.25fr] gap-2">
            <Button
              variant="surface"
              className="h-12 px-3 text-label-md"
              onClick={handleCancelSkip}
              disabled={skipProposal.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              className="h-12 px-3 text-label-md"
              onClick={() => void handleSkip()}
              disabled={skipConfirmDisabled}
              aria-label={skipReason ? 'Save feedback and skip proposal' : 'Skip proposal'}
            >
              {skipConfirmLabel}
            </Button>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-md grid-cols-[0.75fr_0.9fr_1.35fr] gap-2">
            <Button
              variant="surface"
              className="h-12 gap-1 px-2 text-label-md"
              onClick={onBack}
              disabled={executing || skipProposal.isPending}
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              Back
            </Button>
            <Button
              variant="outline"
              className="h-12 gap-1 px-2 text-label-md"
              onClick={() => setSkipOpen(true)}
              disabled={executing || skipProposal.isPending || isReadOnly}
            >
              <span className="material-symbols-outlined text-[20px]">feedback</span>
              Skip
            </Button>
            <Button
              variant="accent"
              className="h-12 px-2 text-label-md"
              onClick={() => void handlePlace()}
              disabled={orderDisabled}
              aria-label="Place order"
            >
              {executing ? 'Placing' : 'Place order'}
            </Button>
          </div>
        )}
      </footer>
    </>
  );
}

function BackIconButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-primary shadow-sm transition-transform active:scale-[0.97]"
    >
      <span className="material-symbols-outlined text-[22px]">arrow_back</span>
    </button>
  );
}

function ThesisRow({ item }: { item: ThesisItem }) {
  const toneClass =
    item.tone === 'accent'
      ? 'bg-accent-container text-on-accent-container'
      : item.tone === 'secondary'
        ? 'bg-secondary-container text-on-secondary-container'
        : 'bg-surface-container text-on-surface';

  return (
    <article className="flex gap-3">
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClass}`}
      >
        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
      </div>
      <div className="min-w-0">
        <div className="text-label-sm text-on-surface-variant">{item.eyebrow}</div>
        <h3 className="mt-0.5 text-title-md text-on-surface">{item.title}</h3>
        <p className="mt-1 text-body-md leading-6 text-on-surface-variant">{item.body}</p>
      </div>
    </article>
  );
}

function LockedMarketMoveRow() {
  return (
    <article className="flex gap-3 rounded-lg bg-surface-container p-3">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
        <span className="material-symbols-outlined text-[20px]">lock</span>
      </div>
      <div className="min-w-0">
        <div className="text-label-sm text-on-surface-variant">Market move</div>
        <h3 className="mt-0.5 text-title-md text-on-surface">What moved</h3>
        <p className="mt-1 text-body-md leading-6 text-on-surface-variant">
          Recruit Quant Analyst to unlock market-move read.
        </p>
      </div>
    </article>
  );
}

function ImpactRow({
  label,
  before,
  after,
  tone = 'neutral',
  last,
}: {
  label: string;
  before: string;
  after: string;
  tone?: 'neutral' | 'negative';
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-3 ${last ? '' : 'border-b border-divider'}`}
    >
      <div className="text-body-md text-on-surface-variant">{label}</div>
      <div className="flex shrink-0 items-center gap-2 font-mono text-body-md text-on-surface">
        <span>{before}</span>
        <span className="material-symbols-outlined text-[16px] text-icon-muted">arrow_forward</span>
        <span className={tone === 'negative' ? 'text-negative' : 'text-on-surface'}>{after}</span>
      </div>
    </div>
  );
}
