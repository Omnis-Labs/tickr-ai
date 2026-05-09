'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useMemo } from 'react';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { HoldingsList } from '@/components/portfolio/holdings-list';
import { usePortfolio } from '@/lib/hooks/queries';
import { derivePortfolioSummary } from '@/lib/portfolio/summary';
import { useWallet } from '@/lib/wallet/use-wallet';

function formatUsdc(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSol(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value < 0.01 && value > 0 ? 6 : 4,
    maximumFractionDigits: 6,
  });
}

/**
 * Portfolio surface: total value + PnL header, holdings card list, and
 * recent-trades log. Reads usePortfolio() — same query as /desk so caches
 * coalesce. Cash + positions value combine into the total displayed at
 * the top so the number matches Desk's hero card.
 */
export default function PortfolioPage() {
  const { connected } = useWallet();
  const portfolioQuery = usePortfolio();
  const data = portfolioQuery.data;
  const isLoading = portfolioQuery.isLoading;

  const summary = useMemo(() => derivePortfolioSummary(data), [data]);
  const solBalance = data?.solBalance ?? 0;

  return (
    <>
      <TopAppBar title="Portfolio" />

      <main className="px-5 py-6 pb-24 max-w-md mx-auto">
        {!connected ? (
          <div className="bg-surface rounded-lg p-6 shadow-soft flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-primary text-[24px]">login</span>
            </div>
            <p className="text-title-md text-primary mb-1">Sign in to load your portfolio</p>
            <p className="text-body-sm text-on-surface-variant mb-4">Your holdings, PnL, and recent trades will appear here.</p>
            <Link href="/login" className="px-5 py-2.5 bg-primary text-on-primary rounded-full text-label-md active:scale-[0.97] transition-transform">
              Sign in
            </Link>
          </div>
        ) : (
          <>
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
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-label-lg text-on-surface-variant">Total Value</span>
                      <span className="text-number-xl text-primary tracking-tight">
                        ${summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="flex gap-2 mt-3 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-label-sm font-semibold ${summary.dayPnlPositive ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'}`}>
                        Day {summary.dayPnlPositive ? '+' : ''}${summary.dayPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({summary.dayPnlPositive ? '+' : ''}{(summary.dayPnlPct * 100).toFixed(1)}%)
                      </span>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-label-sm font-semibold ${summary.totalPnlPositive ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'}`}>
                        Total {summary.totalPnlPositive ? '+' : ''}${summary.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({summary.totalPnlPositive ? '+' : ''}{(summary.totalPnlPct * 100).toFixed(1)}%)
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-divider">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-label-md text-on-surface-variant">Cash (USDC)</span>
                        <span className="text-title-lg text-on-surface tabular-nums">
                          ${summary.cashUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <Link
                        href="/desk#deposit-section"
                        className="flex items-center justify-center gap-2 bg-primary text-on-primary rounded-full h-11 px-5 text-label-lg transition-transform active:scale-[0.97]"
                      >
                        <span className="material-symbols-outlined text-[20px]">add</span>
                        Deposit
                      </Link>
                    </div>
                  </>
                )}
              </motion.div>
            </section>

            <section className="mb-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-title-lg text-primary">Wallet assets</h2>
                <Link
                  href="/withdraw"
                  className="h-9 px-3 rounded-full bg-surface text-on-surface text-label-md flex items-center gap-1 shadow-micro active:scale-[0.97] transition-transform"
                >
                  Withdraw
                  <span className="material-symbols-outlined text-[16px]">north_east</span>
                </Link>
              </div>
              {isLoading ? (
                <div className="bg-surface rounded-lg p-4 h-[132px] animate-pulse shadow-soft" />
              ) : (
                <div className="bg-surface rounded-lg p-4 shadow-soft divide-y divide-divider">
                  <WalletAssetRow
                    icon="payments"
                    label="USDC"
                    detail="Available for proposals"
                    value={`${formatUsdc(summary.cashUsd)} USDC`}
                  />
                  <WalletAssetRow
                    icon="bolt"
                    label="SOL"
                    detail="Network fees and transfers"
                    value={`${formatSol(solBalance)} SOL`}
                  />
                </div>
              )}
            </section>

            <section className="mb-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-title-lg text-primary">Holdings</h2>
              </div>
              <HoldingsList holdings={summary.holdings} isLoading={isLoading} />
            </section>

            <section>
              <h2 className="text-title-lg text-primary mb-4">Recent trades</h2>
              {isLoading ? (
                <div className="bg-surface rounded-lg p-4 h-[120px] animate-pulse shadow-soft" />
              ) : !data || data.trades.length === 0 ? (
                <div className="bg-surface rounded-lg p-6 shadow-soft flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
                    <span className="material-symbols-outlined text-primary text-[24px]">receipt_long</span>
                  </div>
                  <p className="text-title-md text-primary">No trades yet</p>
                  <p className="text-body-sm text-on-surface-variant mt-1">Approve a proposal to start.</p>
                </div>
              ) : (
                <div className="bg-surface rounded-lg p-4 shadow-soft flex flex-col gap-4">
                  {data.trades.slice(0, 20).map((t, i) => {
                    const isBuy = t.side === 'BUY';
                    const sideColor = isBuy ? 'text-positive' : 'text-negative';
                    const pnlColor =
                      t.realizedPnl > 0
                        ? 'text-positive'
                        : t.realizedPnl < 0
                          ? 'text-negative'
                          : 'text-on-surface-variant';
                    return (
                      <div
                        key={t.id}
                        className={`flex justify-between items-center ${i < Math.min(data.trades.length, 20) - 1 ? 'pb-4 border-b border-divider' : ''}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="bg-surface-container-high w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                            <span className={`material-symbols-outlined text-[20px] ${sideColor}`}>
                              {isBuy ? 'trending_up' : 'trending_down'}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-label-lg text-on-surface">{t.ticker}</span>
                              <span className={`text-label-md font-bold ${sideColor}`}>{t.side}</span>
                            </div>
                            <div className="text-body-sm text-on-surface-variant">
                              {new Date(t.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-label-lg text-on-surface tabular-nums">
                            ${t.amountUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className={`text-label-sm font-semibold tabular-nums ${pnlColor}`}>
                            {t.side === 'SELL' ? `${t.realizedPnl >= 0 ? '+' : ''}$${t.realizedPnl.toFixed(2)}` : '—'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

function WalletAssetRow({
  icon,
  label,
  detail,
  value,
}: {
  icon: string;
  label: string;
  detail: string;
  value: string;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-label-lg text-on-surface">{label}</p>
        <p className="text-body-sm text-on-surface-variant">{detail}</p>
      </div>
      <p className="text-label-lg text-on-surface tabular-nums text-right min-w-0 max-w-[48%] break-words">
        {value}
      </p>
    </div>
  );
}
