'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatMinutesUntil, getMarketStatus, type MarketStatus } from '@/lib/market-hours';

/**
 * Off-hours hint shown above the proposals feed. The signal generator
 * uses Pyth publishTime freshness — quotes go stale ~15 minutes after
 * close — so during nights/weekends the feed naturally goes quiet. This
 * banner explains why and points at the next session.
 *
 * Updates every minute; hides itself once we're inside trading hours.
 */
export function MarketHoursBanner() {
  const [status, setStatus] = useState<MarketStatus | null>(null);

  useEffect(() => {
    const tick = () => setStatus(getMarketStatus());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <AnimatePresence>
      {status && !status.isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="mb-4 bg-surface-container-low border border-outline-variant rounded-lg p-4 flex items-start gap-3"
        >
          <span className="material-symbols-outlined text-on-surface-variant text-[20px] mt-0.5">
            schedule
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-label-md text-on-surface">Market closed</p>
            <p className="text-body-sm text-on-surface-variant mt-0.5">
              US equities open in {formatMinutesUntil(status.minutesUntilOpen)}. Proposals are sparse outside trading hours because Pyth quotes go stale.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
