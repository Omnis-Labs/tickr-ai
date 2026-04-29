'use client';

import { motion } from 'framer-motion';

interface PortfolioReadinessProps {
  isLoading: boolean;
  hasCash: boolean;
  hasHoldings: boolean;
  cashUsd: number;
}

type ReadinessState = 'empty' | 'ready' | 'add-usdc' | 'full';

function getReadinessState(hasCash: boolean, hasHoldings: boolean): ReadinessState {
  if (!hasCash && !hasHoldings) return 'empty';
  if (hasCash && !hasHoldings) return 'ready';
  if (hasHoldings && !hasCash) return 'add-usdc';
  return 'full';
}

const readinessConfig: Record<ReadinessState, {
  icon: string;
  title: string;
  subtitle: string;
  showDeposit: boolean;
}> = {
  empty: {
    icon: 'account_balance_wallet',
    title: 'Desk is clear.',
    subtitle: 'Deposit USDC to get started with proposals.',
    showDeposit: true,
  },
  ready: {
    icon: 'check_circle',
    title: 'Ready for proposals',
    subtitle: 'Your USDC is available. Proposals will appear when signals are detected.',
    showDeposit: false,
  },
  'add-usdc': {
    icon: 'info',
    title: 'Add USDC to receive new BUY proposals.',
    subtitle: 'You have open positions but no USDC for new trades.',
    showDeposit: true,
  },
  full: {
    icon: 'trending_up',
    title: 'Portfolio active',
    subtitle: 'You have holdings and USDC ready for new proposals.',
    showDeposit: false,
  },
};

export function PortfolioReadiness({
  isLoading,
  hasCash,
  hasHoldings,
  cashUsd,
}: PortfolioReadinessProps) {
  if (isLoading) return null;

  const state = getReadinessState(hasCash, hasHoldings);

  if (state === 'full') return null;

  const config = readinessConfig[state];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8"
    >
      <div className="bg-surface rounded-lg p-5 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
          <span className="material-symbols-outlined text-primary text-[24px]">{config.icon}</span>
        </div>
        <p className="text-title-md text-primary">{config.title}</p>
        <p className="text-body-sm text-on-surface-variant mt-1">{config.subtitle}</p>
        {state === 'ready' && (
          <p className="text-label-lg text-primary mt-2">
            ${cashUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC available
          </p>
        )}
        {config.showDeposit && (
          <button className="mt-4 flex items-center justify-center gap-2 bg-primary text-on-primary rounded-full px-6 py-3 text-label-lg transition-transform active:scale-[0.97]">
            <span className="material-symbols-outlined text-[20px]">add</span>
            Deposit USDC
          </button>
        )}
      </div>
    </motion.section>
  );
}
