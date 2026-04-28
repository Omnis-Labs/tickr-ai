'use client';

import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet/use-wallet';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useMemo } from 'react';
import { WalletButton } from '@/components/wallet/wallet-button';
import { isDemo, useDemoStore } from '@/lib/demo';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PortfolioPosition {
  ticker: string;
  tokenAmount: number;
  avgCost: number;
  markPrice?: number;
  pnl?: number;
}
interface PortfolioTrade {
  id: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  amountUsd: number;
  tokenAmount: number;
  executionPrice: number;
  txSignature: string;
  status: string;
  realizedPnl: number;
  createdAt: string;
}
interface PortfolioResponse {
  positions: PortfolioPosition[];
  trades: PortfolioTrade[];
  pnl: { realized: number; unrealized: number };
}

export default function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const wallet = publicKey?.toBase58();
  const demo = isDemo();
  const demoPositions = useDemoStore((s) => s.positions);
  const demoTrades = useDemoStore((s) => s.trades);

  const demoData: PortfolioResponse | null = useMemo(() => {
    if (!demo) return null;
    const realized = demoTrades
      .filter((t) => t.side === 'SELL' && t.status === 'CONFIRMED')
      .reduce((acc, t) => acc + t.realizedPnl, 0);
    const unrealized = demoPositions.reduce((acc, p) => acc + (p.pnl ?? 0), 0);
    return {
      positions: demoPositions,
      trades: demoTrades,
      pnl: { realized, unrealized },
    };
  }, [demo, demoPositions, demoTrades]);

  const authedFetch = useAuthedFetch();
  const { data: liveData, isLoading } = useQuery<PortfolioResponse>({
    queryKey: ['portfolio', wallet],
    queryFn: async () => {
      if (!wallet) throw new Error('no wallet');
      const r = await authedFetch(`/api/portfolio`);
      if (!r.ok) throw new Error(`portfolio failed: ${r.status}`);
      return (await r.json()) as PortfolioResponse;
    },
    enabled: !!wallet && !demo,
    refetchInterval: 15_000,
  });

  const data = demo ? demoData : liveData;

  return (
    <main className="mx-auto max-w-[960px] px-6 py-12">
      <Link href="/" className="text-sm text-on-surface-variant hover:text-on-surface">
        ← Home
      </Link>
      <div className="mt-4 mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-extrabold">Portfolio</h1>
        <WalletButton />
      </div>

      {!connected && !demo && (
        <Card>
          <CardContent className="p-5">
            <p className="text-on-surface-variant">Connect a wallet to load your portfolio.</p>
          </CardContent>
        </Card>
      )}

      {(connected || demo) && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <PnlCard label="Realised P&L" value={data?.pnl.realized ?? 0} loading={isLoading} />
            <PnlCard label="Unrealised P&L" value={data?.pnl.unrealized ?? 0} loading={isLoading} />
            <PnlCard
              label="Total"
              value={(data?.pnl.realized ?? 0) + (data?.pnl.unrealized ?? 0)}
              loading={isLoading}
            />
          </div>

          <h2 className="mb-2 mt-6 text-xl font-bold">Positions</h2>
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-container text-left">
                  <Th>Ticker</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Avg cost</Th>
                  <Th align="right">Mark</Th>
                  <Th align="right">Unrealised P&amp;L</Th>
                </tr>
              </thead>
              <tbody>
                {(!data || data.positions.length === 0) && (
                  <tr>
                    <Td colSpan={5} className="text-on-surface-variant">
                      {isLoading ? 'Loading…' : 'No open positions yet. Approve a signal to start.'}
                    </Td>
                  </tr>
                )}
                {data?.positions.map((p, i) => (
                  <motion.tr
                    key={p.ticker}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    className="border-t border-outline-variant"
                  >
                    <Td>{p.ticker}</Td>
                    <Td align="right">{p.tokenAmount.toFixed(4)}</Td>
                    <Td align="right">${p.avgCost.toFixed(2)}</Td>
                    <Td align="right">{p.markPrice ? `$${p.markPrice.toFixed(2)}` : '—'}</Td>
                    <Td
                      align="right"
                      className={cn(
                        p.pnl == null
                          ? 'text-on-surface-variant'
                          : p.pnl >= 0
                            ? 'text-positive'
                            : 'text-negative',
                      )}
                    >
                      {p.pnl == null ? '—' : `$${p.pnl.toFixed(2)}`}
                    </Td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </Card>

          <h2 className="mb-2 mt-6 text-xl font-bold">Recent trades</h2>
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-container text-left">
                  <Th>Time</Th>
                  <Th>Side</Th>
                  <Th>Ticker</Th>
                  <Th align="right">Tokens</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">USD</Th>
                  <Th align="right">P&amp;L</Th>
                  <Th>Tx</Th>
                </tr>
              </thead>
              <tbody>
                {(!data || data.trades.length === 0) && (
                  <tr>
                    <Td colSpan={8} className="text-on-surface-variant">
                      {isLoading ? 'Loading…' : 'No trades yet.'}
                    </Td>
                  </tr>
                )}
                {data?.trades.map((t, i) => (
                  <motion.tr
                    key={t.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.18 }}
                    className="border-t border-outline-variant"
                  >
                    <Td className="text-xs text-on-surface-variant">
                      {new Date(t.createdAt).toLocaleString()}
                    </Td>
                    <Td>
                      <Badge variant={t.side === 'BUY' ? 'positive' : 'destructive'}>
                        {t.side}
                      </Badge>
                    </Td>
                    <Td>{t.ticker}</Td>
                    <Td align="right">{t.tokenAmount.toFixed(4)}</Td>
                    <Td align="right">${t.executionPrice.toFixed(2)}</Td>
                    <Td align="right">${t.amountUsd.toFixed(2)}</Td>
                    <Td
                      align="right"
                      className={cn(
                        t.realizedPnl > 0
                          ? 'text-positive'
                          : t.realizedPnl < 0
                            ? 'text-negative'
                            : 'text-on-surface-variant',
                      )}
                    >
                      {t.side === 'SELL' ? `$${t.realizedPnl.toFixed(2)}` : '—'}
                    </Td>
                    <Td>
                      <a
                        href={`https://solscan.io/tx/${t.txSignature}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        {t.txSignature.slice(0, 6)}…
                      </a>
                    </Td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </main>
  );
}

function PnlCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-1 text-xs uppercase tracking-wider text-on-surface-variant">
          {label}
        </div>
        <div
          className={cn(
            'text-3xl font-bold',
            loading
              ? 'text-on-surface-variant'
              : value > 0
                ? 'text-positive'
                : value < 0
                  ? 'text-negative'
                  : 'text-on-surface',
          )}
        >
          {loading ? '—' : `$${value.toFixed(2)}`}
        </div>
      </CardContent>
    </Card>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  colSpan,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  colSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn('px-4 py-3', align === 'right' ? 'text-right' : 'text-left', className)}
    >
      {children}
    </td>
  );
}
