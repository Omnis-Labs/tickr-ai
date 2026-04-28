'use client';

import type { ReactNode } from 'react';
import { MiniChart, type ChartBar } from '@/components/charts/mini-chart';
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', letterSpacing: '0.06em' }}>
            AI PROPOSAL · conf {(proposal.confidence * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {proposal.ticker}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>{metaName ?? '—'}</div>
          <div style={{ marginTop: 6 }}>
            <span className="badge badge-buy">BUY</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--color-fg-muted)' }}>Expires in</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{exitTtl ?? '—'}</div>
        </div>
      </div>

      <div
        style={{
          background: 'var(--color-bg-muted)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: 14,
          fontSize: 14,
          color: 'var(--color-fg-muted)',
          marginBottom: 16,
          lineHeight: 1.5,
        }}
      >
        {proposal.rationale}
      </div>

      {bars.length > 0 && (
        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: '8px 6px 4px',
            marginBottom: 16,
          }}
        >
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          margin: '12px 0 18px',
          fontSize: 13,
        }}
      >
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
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          color: accent ? 'var(--color-accent-strong)' : 'var(--color-fg-muted)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--color-bg-muted)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '8px 10px',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--color-fg-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{value}</div>
    </div>
  );
}
