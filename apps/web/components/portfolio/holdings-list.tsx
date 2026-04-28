'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useMemo } from 'react';
import { XSTOCKS, xStockToBare, type XStockTicker } from '@hunch-it/shared';
import { isDemo } from '@/lib/demo';
import { useDemoPositionsStore } from '@/lib/store/demo-positions';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
      <Card>
        <CardContent className="p-5 text-center text-sm text-on-surface-variant">
          Live portfolio aggregator is wired in Phase D. Demo mode shows the full Holdings UX.
        </CardContent>
      </Card>
    );
  }

  if (positions.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 text-center text-sm text-on-surface-variant">
          No open positions. Approve a proposal to start.
        </CardContent>
      </Card>
    );
  }

  const totalValue = positions.reduce((acc, p) => acc + p.tokenAmount * p.markPrice, 0);

  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-container text-left">
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
            return (
              <motion.tr
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.025, duration: 0.2 }}
                className="cursor-pointer border-t border-outline-variant"
              >
                <Td>
                  <Link href={`/positions/${p.id}`} className="text-on-surface no-underline">
                    <span className="font-semibold">{p.ticker}</span>
                    <span className="ml-1.5 text-xs text-on-surface-variant">
                      {meta?.name ?? ''}
                    </span>
                  </Link>
                </Td>
                <Td>
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      p.state === 'ACTIVE' ? 'text-positive' : 'text-tertiary',
                    )}
                  >
                    {p.state}
                  </span>
                </Td>
                <Td align="right">{weight.toFixed(1)}%</Td>
                <Td align="right">${value.toFixed(2)}</Td>
                <Td align="right">${p.entryPrice.toFixed(2)}</Td>
                <Td
                  align="right"
                  className={cn(pnl >= 0 ? 'text-positive' : 'text-negative')}
                >
                  {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPct.toFixed(1)}%)
                </Td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant',
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
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={cn('px-4 py-3', align === 'right' ? 'text-right' : 'text-left', className)}>
      {children}
    </td>
  );
}
