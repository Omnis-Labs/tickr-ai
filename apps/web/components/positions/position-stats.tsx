'use client';

import type { ReactNode } from 'react';

export interface PositionStatsData {
  ticker: string;
  tokenAmount: number;
  entryPrice: number;
  markPrice: number;
  currentTpPrice: number | null;
  currentSlPrice: number | null;
}

export interface ComputedStats {
  value: number;
  unrealized: number;
  unrealizedPct: number;
  days: number;
}

interface PositionStatsProps {
  position: PositionStatsData;
  computed: ComputedStats;
}

export function PositionStats({ position, computed }: PositionStatsProps) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Position</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <Stat label="Quantity" value={`${position.tokenAmount.toFixed(4)} ${position.ticker}`} />
        <Stat label="Entry price" value={`$${position.entryPrice.toFixed(2)}`} />
        <Stat label="Mark price" value={`$${position.markPrice.toFixed(2)}`} />
        <Stat label="Value" value={`$${computed.value.toFixed(2)}`} />
        <Stat
          label="Unrealised P&L"
          value={`${computed.unrealized >= 0 ? '+' : ''}$${computed.unrealized.toFixed(2)} (${computed.unrealizedPct.toFixed(1)}%)`}
          color={computed.unrealized >= 0 ? 'var(--color-buy)' : 'var(--color-sell)'}
        />
        <Stat label="Days held" value={`${computed.days}`} />
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
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  color?: string;
}

function Stat({ label, value, color }: StatProps) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color ?? 'var(--color-fg)' }}>{value}</div>
    </div>
  );
}
