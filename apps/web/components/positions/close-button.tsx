'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CloseButtonProps {
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Close-position card for ACTIVE positions. Two-step UX: button → confirm
 * panel. Page receives the confirmation via onConfirm.
 */
export function CloseButton({ busy, onConfirm }: CloseButtonProps) {
  const [confirm, setConfirm] = useState(false);

  if (!confirm) {
    return (
      <Card>
        <CardContent className="p-5">
          <Button variant="destructive" size="lg" className="w-full" onClick={() => setConfirm(true)}>
            Close position
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <p className="mb-3 text-sm text-on-surface-variant">
          Cancel both exit orders and sell the full position at market price?
        </p>
        <div className="flex gap-3">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => setConfirm(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-[2]"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Closing…' : 'Confirm close'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface ClosedSummaryProps {
  closedReason: string | null;
  realizedPnl: number | null;
}

export function ClosedSummary({ closedReason, realizedPnl }: ClosedSummaryProps) {
  const pnl = realizedPnl ?? 0;
  return (
    <Card className="bg-surface-container">
      <CardContent className="p-5">
        <div className="text-sm text-on-surface-variant">
          Closed via {closedReason ?? '—'}
        </div>
        <div className="mt-1 text-2xl font-bold">
          Realised P&L:{' '}
          <span className={cn(pnl >= 0 ? 'text-positive' : 'text-negative')}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
