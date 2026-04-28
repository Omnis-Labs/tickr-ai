'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useMemo } from 'react';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { isDemo } from '@/lib/demo';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';

/**
 * Compact Holdings list shown on Home. Pulls from useDemoPositionsStore in
 * demo mode; live mode stubbed (renders empty hint until /api/portfolio
 * aggregator is rewired in Phase D).
 *
 * Note: select the *raw* positions array and filter via useMemo. Filtering
 * inside the Zustand selector returns a new array reference every read and
 * trips React 19's "getServerSnapshot should be cached" guard, infinite-
 * looping the render.
 */
export function HoldingsList() {
  const demo = isDemo();
  const allPositions = useDemoPositionsStore((s) => s.positions);
  const positions = useMemo(
    () => allPositions.filter((p) => p.state !== 'CLOSED'),
    [allPositions],
  );

  if (!demo) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--color-fg-muted)' }}>
        Live portfolio aggregator is wired in Phase D. Demo mode shows the full Holdings UX.
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--color-fg-muted)' }}>
        No open positions. Approve a proposal to start.
      </div>
    );
  }

  const totalValue = positions.reduce((acc, p) => acc + p.tokenAmount * p.markPrice, 0);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-muted)', textAlign: 'left' }}>
            <Th>Ticker</Th>
            <Th>State</Th>
            <Th align="right">Weight</Th>
            <Th align="right">Value</Th>
            <Th align="right">Entry</Th>
            <Th align="right">Unrealised P&amp;L</Th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            const meta = XSTOCKS[xStockToBare(p.ticker as XStockTicker)];
            const value = p.tokenAmount * p.markPrice;
            const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;
            const pnl = (p.markPrice - p.entryPrice) * p.tokenAmount;
            const pnlPct =
              p.entryPrice > 0 ? ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
            const stateColor =
              p.state === 'ACTIVE' ? 'var(--color-buy)' : 'var(--color-warn)';
            return (
              <motion.tr
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.025, duration: 0.2 }}
                style={{ borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}
              >
                <Td>
                  <Link
                    href={`/positions/${p.id}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    <span style={{ fontWeight: 600 }}>{p.ticker}</span>
                    <span
                      style={{
                        color: 'var(--color-fg-muted)',
                        fontSize: 12,
                        marginLeft: 6,
                      }}
                    >
                      {meta?.name ?? ''}
                    </span>
                  </Link>
                </Td>
                <Td>
                  <span style={{ color: stateColor, fontSize: 12, fontWeight: 600 }}>
                    {p.state}
                  </span>
                </Td>
                <Td align="right">{weight.toFixed(1)}%</Td>
                <Td align="right">${value.toFixed(2)}</Td>
                <Td align="right">${p.entryPrice.toFixed(2)}</Td>
                <Td
                  align="right"
                  style={{ color: pnl >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}
                >
                  {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPct.toFixed(1)}%)
                </Td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '10px 14px',
        fontSize: 11,
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
  style,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <td style={{ textAlign: align ?? 'left', padding: '12px 14px', ...style }}>
      {children}
    </td>
  );
}
