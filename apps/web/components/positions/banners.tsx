'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

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
      className="mb-4 rounded-2xl border border-tertiary/45 bg-tertiary-container/40 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="mb-1 text-xs uppercase tracking-wider text-tertiary">
            BUY FILLED · ACTION REQUIRED
          </div>
          <div className="mb-1 text-base font-bold">
            Place exit orders to activate TP / SL protection
          </div>
          <div className="text-sm leading-relaxed text-on-surface-variant">
            Your BUY filled at ${position.entryPrice.toFixed(2)}. Confirm below to attach a
            take-profit at{' '}
            <strong className="text-positive">
              ${(position.currentTpPrice ?? 0).toFixed(2)}
            </strong>{' '}
            and a stop-loss at{' '}
            <strong className="text-negative">
              ${(position.currentSlPrice ?? 0).toFixed(2)}
            </strong>{' '}
            — each runs as its own Jupiter trigger order.
          </div>
        </div>
        <Button disabled={busy} onClick={onConfirm}>
          {busy ? 'Placing…' : 'Confirm exit orders'}
        </Button>
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
 * parked in Jupiter's vault (non-delegated path).
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
      className="mb-4 rounded-2xl border border-primary/45 bg-primary-container/30 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="mb-1 text-xs uppercase tracking-wider text-primary">
            {reasonLabel} · WITHDRAW
          </div>
          <div className="mb-1 text-base font-bold">
            Cancel the remaining {siblingKind} order
          </div>
          <div className="text-sm leading-relaxed text-on-surface-variant">
            Your {filledKind} has filled. The other leg is still parked in Jupiter&apos;s vault —
            sign once to cancel it and pull the remaining funds back to your wallet.
          </div>
        </div>
        <Button disabled={busy} onClick={onWithdraw}>
          {busy ? 'Cancelling…' : 'Sign & withdraw'}
        </Button>
      </div>
    </motion.div>
  );
}
