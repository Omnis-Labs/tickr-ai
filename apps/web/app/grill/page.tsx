'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, FlameKindling, LoaderCircle, UsersRound } from 'lucide-react';
import { getSignalAssets } from '@hunch-it/shared';
import { GrillResultPanel } from '@/components/grill/grill-result-panel';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { Button } from '@/components/ui/button';
import { useAuthedFetch } from '@/lib/auth/fetch';
import type { GrillAnalysisResult } from '@/lib/grill/analysis';
import { buildGrillProposalRequest } from '@/lib/grill/proposal-policy';
import { useAiTradingTeam } from '@/lib/grill/team-client';
import { appNarrativeCopy } from '@/lib/narrative/copy';
import { cn } from '@/lib/utils';

const assets = getSignalAssets();

export default function GrillPage() {
  const router = useRouter();
  const authedFetch = useAuthedFetch();
  const { selectedIds } = useAiTradingTeam();
  const [assetId, setAssetId] = useState(() => assets[0]?.assetId ?? 'NVDAx');
  const [idea, setIdea] = useState('');
  const [analysis, setAnalysis] = useState<GrillAnalysisResult | null>(null);
  const [busy, setBusy] = useState<'analysis' | 'proposal' | null>(null);

  const hasAnalysis = analysis !== null;

  async function runAnalysis() {
    setBusy('analysis');
    setAnalysis(null);
    try {
      const res = await authedFetch('/api/grill/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId, idea, analystIds: selectedIds }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        analysis?: GrillAnalysisResult;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.analysis)
        throw new Error(body.message ?? body.error ?? `Grill failed (${res.status})`);
      setAnalysis(body.analysis);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function createProposal() {
    if (!analysis) return;
    setBusy('proposal');
    try {
      const proposalRequest = buildGrillProposalRequest(analysis);
      const res = await authedFetch('/api/grill/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proposalRequest),
      });
      const body = (await res.json().catch(() => ({}))) as {
        proposal?: { id: string };
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.proposal?.id)
        throw new Error(body.message ?? body.error ?? `Proposal failed (${res.status})`);
      toast.success('Proposal created from Grill.');
      router.push(`/proposals/${body.proposal.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <TopAppBar
        title="Grill"
        rightAction={
          <Link
            href="/team"
            aria-label="AI Trading Team"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-primary shadow-micro transition-transform active:scale-[0.97] lg:hidden"
          >
            <UsersRound className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      />

      <main
        className={cn(
          'mx-auto grid w-full max-w-md gap-[14px] px-5 pb-36 pt-4 lg:items-start lg:gap-6 lg:px-8 lg:pb-10',
          hasAnalysis
            ? 'lg:max-w-6xl lg:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)]'
            : 'lg:max-w-[520px] lg:grid-cols-1',
        )}
      >
        <div className={cn('flex flex-col gap-[14px]', hasAnalysis && 'lg:sticky lg:top-24')}>
          <section className="rounded-lg bg-accent p-5 text-on-accent shadow-soft">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-label-md text-primary/70">Trade idea</p>
                <h1 className="mt-1 text-headline-md text-primary">Grill</h1>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface/80 text-primary">
                <FlameKindling className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <p className="text-body-md leading-6 text-primary/80">{appNarrativeCopy.grillIntro}</p>
          </section>

          <section className="rounded-lg bg-surface p-5 shadow-soft">
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-label-md text-on-surface-variant">Asset</span>
                <select
                  value={assetId}
                  onChange={(event) => setAssetId(event.target.value)}
                  className="h-12 rounded-full bg-surface-container px-4 text-label-lg text-primary outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary"
                >
                  {assets.map((asset) => (
                    <option key={asset.assetId} value={asset.assetId}>
                      {asset.displaySymbol} · {asset.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-label-md text-on-surface-variant">Trade idea</span>
                <textarea
                  value={idea}
                  onChange={(event) => setIdea(event.target.value)}
                  rows={5}
                  maxLength={1_000}
                  placeholder={appNarrativeCopy.grillPlaceholder}
                  className="min-h-[132px] resize-none rounded-lg bg-surface-container px-4 py-3 text-body-md leading-6 text-on-surface outline-none ring-1 ring-outline-variant placeholder:text-on-surface-variant/70 focus:ring-2 focus:ring-primary"
                />
              </label>

              <Button
                variant="accent"
                className="h-12 w-full gap-2"
                disabled={busy !== null || idea.trim().length < 8}
                onClick={() => void runAnalysis()}
              >
                {busy === 'analysis' ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                )}
                Vet idea
              </Button>
            </div>
          </section>
        </div>

        {analysis && (
          <GrillResultPanel
            analysis={analysis}
            busy={busy}
            onCreateProposal={createProposal}
          />
        )}
      </main>
    </>
  );
}
