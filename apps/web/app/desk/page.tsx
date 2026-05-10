"use client";

import { TopAppBar } from '@/components/shell/top-app-bar';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useMemo } from 'react';
import { ProposalsFeed } from '@/components/desk/proposals-feed';
import { OpenOrders } from '@/components/desk/open-orders';
import { DepositSection } from '@/components/desk/deposit-section';
import { PortfolioReadiness } from '@/components/desk/portfolio-readiness';
import { PanicCloseAll } from '@/components/desk/panic-close-all';
import { HoldingsList } from '@/components/portfolio/holdings-list';
import { usePortfolio } from '@/lib/hooks/queries';
import { derivePortfolioSummary } from '@/lib/portfolio/summary';

export default function DeskPage() {
  const portfolioQuery = usePortfolio();

  const isLoading = portfolioQuery.isLoading;
  const portfolioError = portfolioQuery.error;

  const summary = useMemo(
    () => derivePortfolioSummary(portfolioQuery.data),
    [portfolioQuery.data],
  );
  const hasCash = summary.hasCash;
  const scrollToDeposit = () => {
    document.getElementById('deposit-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <TopAppBar 
        title="Desk" 
        leftAction={
          <div className="w-9 h-9 rounded-full bg-surface-container-high overflow-hidden" />
        }
        rightAction={
          <button aria-label="Notifications" className="w-11 h-11 rounded-full bg-surface flex items-center justify-center text-primary shadow-sm">
            <span className="material-symbols-outlined">notifications</span>
          </button>
        }
      />
      
      <main className="px-5 py-6 pb-24 max-w-md mx-auto">
        {portfolioError && (
          <div className="bg-negative-container text-negative p-3 rounded-md mb-4 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">error</span>
            Some data may be outdated.
          </div>
        )}

        <section className="mb-8">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-surface rounded-lg p-5 shadow-soft"
          >
            {isLoading ? (
              <div className="flex flex-col gap-3 animate-pulse">
                <div className="h-4 w-20 bg-surface-container rounded" />
                <div className="h-8 w-40 bg-surface-container rounded" />
                <div className="h-6 w-32 bg-surface-container rounded-full" />
                <div className="flex items-center gap-3 mt-4">
                  <div className="flex-1 h-12 bg-surface-container rounded-full" />
                  <div className="w-12 h-12 bg-surface-container rounded-full" />
                </div>
              </div>
            ) : portfolioError ? (
              <div className="flex flex-col items-center justify-center py-4 text-center">
                <span className="material-symbols-outlined text-negative text-[24px] mb-2">error</span>
                <p className="text-body-md text-on-surface-variant mb-3">Failed to load portfolio</p>
                <button
                  onClick={() => void portfolioQuery.refetch()}
                  className="px-5 py-2 bg-primary text-on-primary rounded-full text-label-md active:scale-[0.97] transition-transform"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-label-lg text-on-surface-variant">Total Value</span>
                  <span className="text-number-xl text-primary tracking-tight">
                    ${summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex gap-2 mt-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-label-sm font-semibold ${summary.dayPnlPositive ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'}`}>
                    Day {summary.dayPnlPositive ? '+' : ''}${summary.dayPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({summary.dayPnlPositive ? '+' : ''}{(summary.dayPnlPct * 100).toFixed(1)}%)
                  </span>
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-label-sm font-semibold ${summary.totalPnlPositive ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'}`}>
                    Total {summary.totalPnlPositive ? '+' : ''}${summary.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({summary.totalPnlPositive ? '+' : ''}{(summary.totalPnlPct * 100).toFixed(1)}%)
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-divider flex-wrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-label-md text-on-surface-variant">Cash (USDC)</span>
                    <span className="text-title-lg text-on-surface">
                      ${summary.cashUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={scrollToDeposit}
                      className="flex items-center justify-center gap-2 bg-primary text-on-primary rounded-full h-11 px-4 text-label-lg transition-transform active:scale-[0.97]"
                    >
                      <span className="material-symbols-outlined text-[20px]">add</span>
                      Deposit
                    </button>
                    <Link
                      href="/withdraw"
                      className="flex items-center justify-center gap-2 bg-surface-container text-on-surface rounded-full h-11 px-4 text-label-lg transition-transform active:scale-[0.97]"
                    >
                      <span className="material-symbols-outlined text-[20px]">north_east</span>
                      Withdraw
                    </Link>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </section>

        <PortfolioReadiness
          isLoading={isLoading}
          hasCash={hasCash}
          hasHoldings={summary.hasHoldings}
          cashUsd={summary.cashUsd}
          onDeposit={scrollToDeposit}
        />

        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Holdings</h2>
            <button aria-label="Sort holdings" className="flex items-center gap-1 text-on-surface-variant text-label-md transition-opacity active:opacity-70">
              Sort
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">swap_vert</span>
            </button>
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-surface rounded-lg p-4 h-[72px] animate-pulse" />
              ))}
            </div>
          ) : (
            <HoldingsList holdings={summary.holdings} />
          )}
        </section>

        <PanicCloseAll positions={summary.closablePositions} />
        <ProposalsFeed />
        <OpenOrders />
        <DepositSection />
      </main>
    </>
  );
}
