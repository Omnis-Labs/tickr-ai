'use client';

import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet/use-wallet';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useMemo } from 'react';
import { WalletButton } from '@/components/wallet/wallet-button';
import { isDemo, useDemoStore } from '@/lib/demo';
import { useAuthedFetch } from '@/lib/auth/fetch';

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
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: '16px 0 24px',
        }}
      >
        <h1 style={{ fontSize: 32, fontWeight: 800 }}>Portfolio</h1>
        <WalletButton />
      </div>

      {!connected && !demo && (
        <div className="card">
          <p style={{ color: 'var(--color-fg-muted)' }}>Connect a wallet to load your portfolio.</p>
        </div>
      )}

      {(connected || demo) && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <PnlCard label="Realised P&L" value={data?.pnl.realized ?? 0} loading={isLoading} />
            <PnlCard label="Unrealised P&L" value={data?.pnl.unrealized ?? 0} loading={isLoading} />
            <PnlCard
              label="Total"
              value={(data?.pnl.realized ?? 0) + (data?.pnl.unrealized ?? 0)}
              loading={isLoading}
            />
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '24px 0 8px' }}>Positions</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-muted)', textAlign: 'left' }}>
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
                    <Td colSpan={5} style={{ color: 'var(--color-fg-muted)' }}>
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
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <Td>{p.ticker}</Td>
                    <Td align="right">{p.tokenAmount.toFixed(4)}</Td>
                    <Td align="right">${p.avgCost.toFixed(2)}</Td>
                    <Td align="right">{p.markPrice ? `$${p.markPrice.toFixed(2)}` : '—'}</Td>
                    <Td
                      align="right"
                      style={{
                        color:
                          p.pnl == null
                            ? 'var(--color-fg-muted)'
                            : p.pnl >= 0
                              ? 'var(--color-buy)'
                              : 'var(--color-sell)',
                      }}
                    >
                      {p.pnl == null ? '—' : `$${p.pnl.toFixed(2)}`}
                    </Td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '24px 0 8px' }}>Recent trades</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-muted)', textAlign: 'left' }}>
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
                    <Td colSpan={8} style={{ color: 'var(--color-fg-muted)' }}>
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
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <Td style={{ color: 'var(--color-fg-muted)', fontSize: 12 }}>
                      {new Date(t.createdAt).toLocaleString()}
                    </Td>
                    <Td>
                      <span className={`badge ${t.side === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>
                        {t.side}
                      </span>
                    </Td>
                    <Td>{t.ticker}</Td>
                    <Td align="right">{t.tokenAmount.toFixed(4)}</Td>
                    <Td align="right">${t.executionPrice.toFixed(2)}</Td>
                    <Td align="right">${t.amountUsd.toFixed(2)}</Td>
                    <Td
                      align="right"
                      style={{
                        color:
                          t.realizedPnl > 0
                            ? 'var(--color-buy)'
                            : t.realizedPnl < 0
                              ? 'var(--color-sell)'
                              : 'var(--color-fg-muted)',
                      }}
                    >
                      {t.side === 'SELL' ? `$${t.realizedPnl.toFixed(2)}` : '—'}
                    </Td>
                    <Td>
                      <a
                        href={`https://solscan.io/tx/${t.txSignature}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--color-accent)', fontSize: 12 }}
                      >
                        {t.txSignature.slice(0, 6)}…
                      </a>
                    </Td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
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
  const color =
    value > 0 ? 'var(--color-buy)' : value < 0 ? 'var(--color-sell)' : 'var(--color-fg)';
  return (
    <div className="card">
      <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: loading ? 'var(--color-fg-muted)' : color }}>
        {loading ? '—' : `$${value.toFixed(2)}`}
      </div>
    </div>
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
      style={{
        textAlign: align ?? 'left',
        padding: '10px 14px',
        fontSize: 12,
        color: 'var(--color-fg-muted)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  colSpan,
  style,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  colSpan?: number;
  style?: React.CSSProperties;
}) {
  return (
    <td colSpan={colSpan} style={{ textAlign: align ?? 'left', padding: '12px 14px', ...style }}>
      {children}
    </td>
  );
}
