'use client';

import type { ReactNode } from 'react';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DemoProposalShape } from '@hunch-it/shared';

interface ProposalHeaderProps {
  proposal: DemoProposalShape;
  metaName: string | undefined;
  exitTtl: string | null;
  bars: ChartBar[];
}

/**
 * Top of the Proposal Modal: ticker + confidence + TTL, rationale paragraph,
 * historical chart with a price-at-proposal marker, and the three reasoning
 * sections + position-impact mini stats.
 */
export function ProposalHeader({ proposal, metaName, exitTtl, bars }: ProposalHeaderProps) {
  const markerColor = '#22c55e'; // BUY only in v1.3

  return (
    <>
      <div className="mb-3.5 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-on-surface-variant">
            AI PROPOSAL · conf {(proposal.confidence * 100).toFixed(0)}%
          </div>
          <div className="text-4xl font-extrabold tracking-tight">{proposal.ticker}</div>
          <div className="text-sm text-on-surface-variant">{metaName ?? '—'}</div>
          <div className="mt-1.5">
            <Badge variant="positive">BUY</Badge>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-on-surface-variant">Expires in</div>
          <div className="text-lg font-bold">{exitTtl ?? '—'}</div>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-outline-variant bg-surface-container p-4 text-sm leading-relaxed text-on-surface-variant">
        {proposal.rationale}
      </div>

      {bars.length > 0 && (
        <div className="mb-4 rounded-2xl border border-outline-variant px-1.5 pt-2 pb-1">
          <MiniChart
            bars={bars}
            height={150}
            marker={{
              price: proposal.priceAtProposal,
              label: 'price@proposal',
              color: markerColor,
            }}
          />
        </div>
      )}

      <Section title="What changed">{proposal.reasoning.what_changed}</Section>
      <Section title="Why this trade">{proposal.reasoning.why_this_trade}</Section>
      <Section title="Why it fits your mandate" accent>
        {proposal.reasoning.why_fits_mandate}
      </Section>

      <div className="my-3 mb-4 grid grid-cols-3 gap-2.5 text-sm">
        <Stat
          label="Weight"
          value={`${(proposal.positionImpact.weight_before * 100).toFixed(1)}% → ${(proposal.positionImpact.weight_after * 100).toFixed(1)}%`}
        />
        <Stat label="Cash after" value={`$${proposal.positionImpact.cash_after.toFixed(0)}`} />
        <Stat
          label="Sector"
          value={`${(proposal.positionImpact.sector_before * 100).toFixed(0)}% → ${(proposal.positionImpact.sector_after * 100).toFixed(0)}%`}
        />
      </div>
    </>
  );
}

function Section({
  title,
  children,
  accent,
}: {
  title: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="mb-3">
      <div
        className={cn(
          'mb-1 text-[11px] uppercase tracking-wider',
          accent ? 'text-primary' : 'text-on-surface-variant',
        )}
      >
        {title}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-outline-variant bg-surface-container px-2.5 py-2">
      <div className="mb-0.5 text-[11px] text-on-surface-variant">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
