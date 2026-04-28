'use client';

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-lg font-bold">Position</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Stat label="Quantity" value={`${position.tokenAmount.toFixed(4)} ${position.ticker}`} />
        <Stat label="Entry price" value={`$${position.entryPrice.toFixed(2)}`} />
        <Stat label="Mark price" value={`$${position.markPrice.toFixed(2)}`} />
        <Stat label="Value" value={`$${computed.value.toFixed(2)}`} />
        <Stat
          label="Unrealised P&L"
          value={`${computed.unrealized >= 0 ? '+' : ''}$${computed.unrealized.toFixed(2)} (${computed.unrealizedPct.toFixed(1)}%)`}
          tone={computed.unrealized >= 0 ? 'positive' : 'negative'}
        />
        <Stat label="Days held" value={`${computed.days}`} />
        <Stat
          label="Take profit"
          value={position.currentTpPrice ? `$${position.currentTpPrice.toFixed(2)}` : '—'}
          tone="positive"
        />
        <Stat
          label="Stop loss"
          value={position.currentSlPrice ? `$${position.currentSlPrice.toFixed(2)}` : '—'}
          tone="negative"
        />
      </CardContent>
    </Card>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  tone?: 'positive' | 'negative';
}

function Stat({ label, value, tone }: StatProps) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-on-surface-variant">{label}</div>
      <div
        className={cn(
          'text-base font-semibold',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
        )}
      >
        {value}
      </div>
    </div>
  );
}
