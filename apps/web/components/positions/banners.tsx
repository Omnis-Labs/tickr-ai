'use client';

import { motion } from 'framer-motion';

export interface EnterBannerData {
  ticker: string;
  entryPrice: number;
  currentTpPrice: number | null;
  currentSlPrice: number | null;
}

interface EnterBannerProps {
  position: EnterBannerData;
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Shown when Position.state === 'ENTERING' — BUY filled, user must confirm
 * placement of TP / SL trigger orders next.
 */
export function EnterBanner({ position, busy, onConfirm }: EnterBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card"
      style={{
        background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.04))',
        border: '1px solid rgba(245,158,11,0.45)',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--color-warn)',
              marginBottom: 4,
            }}
          >
            BUY FILLED · ACTION REQUIRED
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            Place exit orders to activate TP / SL protection
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
            Your BUY filled at ${position.entryPrice.toFixed(2)}. Confirm below to attach a
            take-profit at{' '}
            <strong style={{ color: 'var(--color-buy)' }}>
              ${(position.currentTpPrice ?? 0).toFixed(2)}
            </strong>{' '}
            and a stop-loss at{' '}
            <strong style={{ color: 'var(--color-sell)' }}>
              ${(position.currentSlPrice ?? 0).toFixed(2)}
            </strong>{' '}
            — each runs as its own Jupiter trigger order.
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Placing…' : 'Confirm exit orders'}
        </button>
      </div>
    </motion.div>
  );
}

interface CancelSiblingBannerProps {
  closedReason: string | null;
  siblingKind: 'TP' | 'SL';
  busy: boolean;
  onWithdraw: () => void;
}

/**
 * Shown when Position.state === 'CLOSED' and the partner TP/SL leg is still
 * parked in Jupiter's vault (non-delegated path). Click → user signs the
 * withdraw + cancel via useJupiterTrigger.cancel.
 */
export function CancelSiblingBanner({
  closedReason,
  siblingKind,
  busy,
  onWithdraw,
}: CancelSiblingBannerProps) {
  const reasonLabel = closedReason === 'TP_FILLED' ? 'TP FILLED' : 'SL FILLED';
  const filledKind = closedReason === 'TP_FILLED' ? 'take-profit' : 'stop-loss';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card"
      style={{
        background: 'linear-gradient(135deg, rgba(124,92,255,0.18), rgba(124,92,255,0.04))',
        border: '1px solid rgba(124,92,255,0.45)',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--color-accent-strong)',
              marginBottom: 4,
            }}
          >
            {reasonLabel} · WITHDRAW
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            Cancel the remaining {siblingKind} order
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
            Your {filledKind} has filled. The other leg is still parked in Jupiter's vault — sign
            once to cancel it and pull the remaining funds back to your wallet.
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={onWithdraw}>
          {busy ? 'Cancelling…' : 'Sign & withdraw'}
        </button>
      </div>
    </motion.div>
  );
}
