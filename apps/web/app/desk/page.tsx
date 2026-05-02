"use client";

import { TopAppBar } from '@/components/shell/top-app-bar';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { ProposalsFeed } from '@/components/desk/proposals-feed';
import { OpenOrders } from '@/components/desk/open-orders';
import { DepositSection } from '@/components/desk/deposit-section';
import { MarketHoursBanner } from '@/components/desk/market-hours-banner';
import { PortfolioReadiness } from '@/components/desk/portfolio-readiness';
import { PanicCloseAll } from '@/components/desk/panic-close-all';
import { usePortfolio, usePositions } from '@/lib/hooks/queries';

export default function DeskPage() {
  const router = useRouter();

  const positionsQuery = usePositions();
  const portfolioQuery = usePortfolio();

  const isLoading = positionsQuery.isLoading || portfolioQuery.isLoading;
  const portfolioError = positionsQuery.error || portfolioQuery.error;

  const positions = useMemo(
    () =>
      (positionsQuery.data?.positions ?? []).map((p) => {
        const meta = XSTOCKS[xStockToBare(p.ticker as XStockTicker)];
        return {
          id: p.id,
          assetId: p.ticker,
          state: p.state,
          tokenAmount: p.tokenAmount,
          entryPrice: p.entryPrice,
          totalCost: p.tokenAmount * p.entryPrice,
          ticker: meta?.ticker ?? p.ticker,
          name: meta?.name ?? p.ticker,
        };
      }),
    [positionsQuery.data],
  );

  const realized = portfolioQuery.data?.pnl.realized ?? 0;
  const unrealized = portfolioQuery.data?.pnl.unrealized ?? 0;
  const totalPnl = realized + unrealized;
  const dayPnl = unrealized; // 24h delta not tracked separately yet
  const totalValue = positions.reduce((acc, p) => acc + p.totalCost, 0) + realized;
  const totalPnlPct = totalValue > 0 ? totalPnl / totalValue : 0;
  const dayPnlPct = totalValue > 0 ? dayPnl / totalValue : 0;
  const dayPnlPositive = dayPnl >= 0;
  const totalPnlPositive = totalPnl >= 0;

  const cashUsd = portfolioQuery.data?.cashUsd ?? 0;
  const hasHoldings = positions.filter((p) => p.state !== 'CLOSED').length > 0;
  const hasCash = cashUsd > 0;

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
                  onClick={() => {}}
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
                    ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex gap-2 mt-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-label-sm font-semibold ${dayPnlPositive ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'}`}>
                    Day {dayPnlPositive ? '+' : ''}${dayPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({dayPnlPositive ? '+' : ''}{(dayPnlPct * 100).toFixed(1)}%)
                  </span>
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-label-sm font-semibold ${totalPnlPositive ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'}`}>
                    Total {totalPnlPositive ? '+' : ''}${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({totalPnlPositive ? '+' : ''}{(totalPnlPct * 100).toFixed(1)}%)
                  </span>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-divider">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-label-md text-on-surface-variant">Cash (USDC)</span>
                    <span className="text-title-lg text-on-surface">
                      ${cashUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => document.getElementById('deposit-section')?.scrollIntoView({ behavior: 'smooth' })}
                      className="flex items-center justify-center gap-2 bg-primary text-on-primary rounded-full h-11 px-5 text-label-lg transition-transform active:scale-[0.97]"
                    >
                      <span className="material-symbols-outlined text-[20px]">add</span>
                      Deposit
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </section>

        <PortfolioReadiness
          isLoading={isLoading}
          hasCash={hasCash}
          hasHoldings={hasHoldings}
          cashUsd={cashUsd}
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
          ) : positions.length === 0 ? (
            <div className="bg-surface rounded-lg p-6 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
                <span className="material-symbols-outlined text-primary text-[24px]">account_balance_wallet</span>
              </div>
              <p className="text-title-md text-primary">No positions yet</p>
              <p className="text-body-sm text-on-surface-variant mt-1">Execute a proposal to open your first position.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {positions.filter(p => p.state !== 'CLOSED').map((pos, i) => {
                const ticker = pos.ticker ?? pos.assetId;
                const name = pos.name ?? pos.assetId;
                const value = pos.totalCost ?? 0;
                const pnl = pos.entryPrice && pos.totalCost
                  ? ((pos.totalCost / (pos.tokenAmount ?? 1)) - pos.entryPrice) / pos.entryPrice
                  : 0;
                const isPositive = pnl >= 0;

                return (
                  <motion.div
                    key={pos.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    onClick={() => router.push(`/positions/${pos.id}`)}
                    className="bg-surface rounded-lg p-4 flex items-center gap-3 cursor-pointer active:scale-[0.97] transition-transform"
                  >
                    <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-label-sm font-bold text-primary shrink-0">
                      {ticker}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-label-lg text-on-surface line-clamp-1">{name}</div>
                      <div className="text-body-sm text-on-surface-variant">{ticker}</div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-label-lg text-on-surface tabular-nums">
                        ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className={`text-label-sm font-semibold tabular-nums ${isPositive ? 'text-positive' : 'text-negative'}`}>
                        {isPositive ? '+' : ''}{(pnl * 100).toFixed(1)}%
                      </div>
                    </div>

                    <span className="material-symbols-outlined text-[18px] text-icon-muted shrink-0">chevron_right</span>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>

        <PanicCloseAll
          positions={positions.map((p) => ({
            id: p.id,
            ticker: p.assetId,
            tokenAmount: p.tokenAmount,
            entryPrice: p.entryPrice,
            state: p.state,
          }))}
        />
        <MarketHoursBanner />
        <ProposalsFeed />
        <OpenOrders />
        <DepositSection />
      </main>
    </>
  );
}
