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
            — each runs as its own synthetic Order.
          </div>
        </div>
        <Button disabled={busy} onClick={onConfirm}>
          {busy ? 'Placing…' : 'Confirm exit orders'}
        </Button>
      </div>
    </motion.div>
  );
}
