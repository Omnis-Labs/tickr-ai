'use client';

import {
  ChevronDown,
  CircleAlert,
  CircleSlash2,
  LoaderCircle,
  ShieldCheck,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AnalystOpinion, AnalystVerdict, GrillAnalysisResult } from '@/lib/grill/analysis';
import { canCreateGrillProposal } from '@/lib/grill/proposal-policy';
import {
  buildGrillResultPresentation,
  type GrillResultPresentation,
} from '@/lib/grill/result-summary';
import { cn } from '@/lib/utils';

type GrillBusyState = 'analysis' | 'proposal' | null;

interface GrillResultPanelProps {
  analysis: GrillAnalysisResult;
  busy: GrillBusyState;
  onCreateProposal: () => void | Promise<void>;
}

const verdictMeta: Record<
  AnalystVerdict,
  {
    label: string;
    Icon: LucideIcon;
    badgeClassName: string;
    panelClassName: string;
    countClassName: string;
  }
> = {
  support: {
    label: 'Support',
    Icon: ShieldCheck,
    badgeClassName: 'bg-positive-container text-primary',
    panelClassName: 'border-positive/30 bg-positive-container/35',
    countClassName: 'bg-positive-container text-primary',
  },
  challenge: {
    label: 'Challenge',
    Icon: CircleAlert,
    badgeClassName: 'bg-tertiary-container text-on-tertiary-container',
    panelClassName: 'border-tertiary/40 bg-tertiary-container/45',
    countClassName: 'bg-tertiary-container text-on-tertiary-container',
  },
  reject: {
    label: 'Reject',
    Icon: CircleSlash2,
    badgeClassName: 'bg-negative-container text-on-error-container',
    panelClassName: 'border-negative/30 bg-negative-container/35',
    countClassName: 'bg-negative-container text-on-error-container',
  },
};

const verdictOrder: AnalystVerdict[] = ['support', 'challenge', 'reject'];

export function GrillResultPanel({
  analysis,
  busy,
  onCreateProposal,
}: GrillResultPanelProps) {
  const presentation = buildGrillResultPresentation(analysis);
  const canCreateProposal = canCreateGrillProposal(analysis, busy);

  return (
    <div className="flex flex-col gap-[14px]">
      <ResultSummaryCard presentation={presentation} />

      <section className="flex flex-col gap-[14px]">
        {analysis.opinions.map((opinion) => (
          <OpinionCard key={opinion.analystId} opinion={opinion} />
        ))}
      </section>

      <section className="rounded-lg bg-surface p-4 shadow-soft sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-title-md text-on-surface">Proposal</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              {presentation.proposalBody}
            </p>
          </div>
          <span className="rounded-full bg-surface-container px-3 py-1 text-label-sm text-on-surface-variant">
            {analysis.assetId}
          </span>
        </div>
        <Button
          variant="accent"
          className="h-12 w-full gap-2"
          disabled={!canCreateProposal}
          onClick={() => void onCreateProposal()}
        >
          {busy === 'proposal' && (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {presentation.proposalActionLabel}
        </Button>
      </section>
    </div>
  );
}

function ResultSummaryCard({ presentation }: { presentation: GrillResultPresentation }) {
  return (
    <section className="rounded-lg bg-surface p-4 shadow-soft sm:p-5">
      <div className="mb-4">
        <p className="text-label-md text-on-surface-variant">Vetting result</p>
        <h2 className="mt-1 text-title-lg text-on-surface">{presentation.summaryLine}</h2>
        <p className="mt-2 text-body-sm leading-5 text-on-surface-variant">
          {presentation.guidance}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {verdictOrder.map((verdict) => {
          const meta = verdictMeta[verdict];
          const Icon = meta.Icon;

          return (
            <div
              key={verdict}
              className={cn('rounded-lg px-3 py-3 text-center', meta.countClassName)}
            >
              <Icon className="mx-auto mb-1 h-4 w-4" aria-hidden="true" />
              <p className="text-number-md">{presentation.counts[verdict]}</p>
              <p className="text-label-sm">{meta.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OpinionCard({ opinion }: { opinion: AnalystOpinion }) {
  const tone = verdictMeta[opinion.verdict];
  const VerdictIcon = tone.Icon;
  const primaryDetails: {
    label: string;
    body: string;
    Icon: LucideIcon;
  }[] = [
    { label: 'Entry', body: opinion.setupEntry, Icon: Target },
    { label: 'Wrong if', body: opinion.invalidation, Icon: CircleSlash2 },
  ];
  const secondaryDetails = [
    { label: 'Why now', body: opinion.whyNow, Icon: TrendingUp },
    { label: 'Protection', body: opinion.riskProtection, Icon: ShieldCheck },
  ];

  return (
    <article className="rounded-lg bg-surface p-4 shadow-soft sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label-sm',
                tone.badgeClassName,
              )}
            >
              <VerdictIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {tone.label}
            </span>
            <span className="rounded-full bg-surface-container px-2.5 py-1 text-label-sm text-on-surface-variant">
              {(opinion.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <h2 className="text-title-lg text-on-surface">{opinion.analystName}</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">{opinion.originTask}</p>
        </div>
      </div>

      <div className={cn('rounded-lg border px-3 py-3', tone.panelClassName)}>
        <p className="text-label-sm text-on-surface-variant">Main read</p>
        <p className="mt-1 line-clamp-3 text-body-md leading-6 text-on-surface">
          {opinion.thesis}
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {primaryDetails.map((item) => (
          <OpinionSection key={item.label} label={item.label} body={item.body} Icon={item.Icon} />
        ))}
      </div>

      <details className="group mt-3 rounded-lg bg-surface-container-low px-3 py-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-label-sm text-on-surface-variant [&::-webkit-details-marker]:hidden">
          More context
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {secondaryDetails.map((item) => (
            <OpinionSection
              key={item.label}
              label={item.label}
              body={item.body}
              Icon={item.Icon}
              variant="surface"
            />
          ))}
        </div>
      </details>
    </article>
  );
}

function OpinionSection({
  label,
  body,
  Icon,
  variant = 'container',
}: {
  label: string;
  body: string;
  Icon: LucideIcon;
  variant?: 'container' | 'surface';
}) {
  return (
    <section
      className={cn(
        'rounded-lg px-3 py-3',
        variant === 'surface' ? 'bg-surface' : 'bg-surface-container-low',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-on-surface-variant">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <p className="text-label-sm">{label}</p>
      </div>
      <p
        className={cn(
          'text-body-sm leading-5 text-on-surface',
          variant === 'container' && 'line-clamp-2',
        )}
      >
        {body}
      </p>
    </section>
  );
}
