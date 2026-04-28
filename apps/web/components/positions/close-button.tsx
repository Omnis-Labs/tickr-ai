'use client';

import { useState } from 'react';

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
      <div className="card">
        <button
          className="btn btn-sell"
          style={{ width: '100%', padding: '14px 24px', fontSize: 15 }}
          onClick={() => setConfirm(true)}
        >
          Close position
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, marginBottom: 12 }}>
        Cancel both exit orders and sell the full position at market price?
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={() => setConfirm(false)}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          className="btn btn-sell"
          style={{ flex: 2 }}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Closing…' : 'Confirm close'}
        </button>
      </div>
    </div>
  );
}

interface ClosedSummaryProps {
  closedReason: string | null;
  realizedPnl: number | null;
}

export function ClosedSummary({ closedReason, realizedPnl }: ClosedSummaryProps) {
  const pnl = realizedPnl ?? 0;
  return (
    <div className="card" style={{ background: 'var(--color-bg-muted)' }}>
      <div style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
        Closed via {closedReason ?? '—'}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
        Realised P&L:{' '}
        <span style={{ color: pnl >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
