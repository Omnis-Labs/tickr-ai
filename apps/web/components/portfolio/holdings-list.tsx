'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';

/**
 * Compact card-row holdings list. Caller hydrates `holdings[]` from
 * usePositions / useDemoPositionsStore — keeps this component a pure
 * presentation layer and avoids the React 19 snapshot loop we hit
 * earlier when filtering inside Zustand selectors.
 */
export interface Holding {
  id: string;
  assetId: string;
  name: string;
  ticker: string;
  value: number;
  pnl: number;
  pnlPct: number;
  state: 'ACTIVE' | 'CLOSED' | string;
}

interface HoldingsListProps {
  holdings: Holding[];
  isLoading?: boolean;
}

export function HoldingsList({ holdings, isLoading }: HoldingsListProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface rounded-lg p-4 h-[72px] animate-pulse shadow-soft" />
        ))}
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="bg-surface rounded-lg p-6 flex flex-col items-center justify-center text-center shadow-soft">
        <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
          <span className="material-symbols-outlined text-primary text-[24px]">account_balance_wallet</span>
        </div>
        <p className="text-title-md text-primary">No positions yet</p>
        <p className="text-body-sm text-on-surface-variant mt-1">Execute a proposal to open your first position.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {holdings.map((pos, i) => {
        const isPositive = pos.pnl >= 0;
        return (
          <motion.div
            key={pos.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            onClick={() => router.push(`/positions/${pos.id}`)}
            className="bg-surface rounded-lg p-4 flex items-center gap-3 cursor-pointer active:scale-[0.97] transition-transform shadow-soft"
          >
            <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-label-sm font-bold text-primary shrink-0">
              {pos.ticker}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-label-lg text-on-surface line-clamp-1">{pos.name}</div>
              <div className="text-body-sm text-on-surface-variant">{pos.ticker}</div>
            </div>

            <div className="text-right shrink-0">
              <div className="text-label-lg text-on-surface tabular-nums">
                ${pos.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`text-label-sm font-semibold tabular-nums ${isPositive ? 'text-positive' : 'text-negative'}`}>
                {isPositive ? '+' : ''}{(pos.pnlPct * 100).toFixed(1)}%
              </div>
            </div>

            <span className="material-symbols-outlined text-[18px] text-icon-muted shrink-0">chevron_right</span>
          </motion.div>
        );
      })}
    </div>
  );
}
