'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { XSTOCKS, xStockToBare, type DemoProposalShape, type XStockTicker } from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo';
import { useProposalsStore } from '@/lib/store/proposals';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { useMemo } from 'react';

interface ProposalsFeedProps {
  limit?: number;
}

function fmtTtl(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60_000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

export function ProposalsFeed({ limit = 8 }: ProposalsFeedProps) {
  const { address } = useWallet();
  const demo = isDemo();
  const wallet = demo ? 'demo-wallet' : address;

  // Pull seed proposals from /api/proposals so the feed is non-empty even
  // before the live socket has emitted anything.
  const authedFetch = useAuthedFetch();
  const { data, isLoading } = useQuery<{ proposals: DemoProposalShape[] }>({
    queryKey: ['proposals', wallet],
    queryFn: async () => {
      if (!wallet) return { proposals: [] };
      const r = await authedFetch(`/api/proposals`);
      if (!r.ok) return { proposals: [] };
      return r.json();
    },
    enabled: !!wallet,
    refetchInterval: 30_000,
  });

  // Live in-memory store (proposal:new pushes append here).
  const live = useProposalsStore((s) => s.order.map((id) => s.proposalsById[id]));

  // Merge: in-memory first, then API seed (de-duped by id), sorted by expiry.
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: DemoProposalShape[] = [];
    for (const p of live) {
      if (!p || seen.has(p.id)) continue;
      out.push(p);
      seen.add(p.id);
    }
    for (const p of data?.proposals ?? []) {
      if (seen.has(p.id)) continue;
      out.push(p);
      seen.add(p.id);
    }
    return out
      .filter((p) => new Date(p.expiresAt).getTime() > Date.now())
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())
      .slice(0, limit);
  }, [live, data, limit]);

  if (isLoading && merged.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--color-fg-muted)' }}>
        Loading proposals…
      </div>
    );
  }

  if (merged.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--color-fg-muted)' }}>
        Desk is clear.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {merged.map((p, i) => {
        const meta = XSTOCKS[xStockToBare(p.ticker as XStockTicker)];
        return (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.03 }}
          >
            <Link
              href={`/proposals/${p.id}`}
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                textDecoration: 'none',
                padding: '14px 16px',
              }}
            >
              <span className="badge badge-buy">BUY</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {p.ticker}{' '}
                  <span
                    style={{ color: 'var(--color-fg-muted)', fontWeight: 400, fontSize: 13 }}
                  >
                    · {meta?.name ?? '—'}
                  </span>
                </div>
                <div
                  style={{
                    color: 'var(--color-fg-muted)',
                    fontSize: 13,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.rationale}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, lineHeight: 1.4 }}>
                <div style={{ fontWeight: 600 }}>${p.suggestedSizeUsd.toFixed(0)}</div>
                <div style={{ color: 'var(--color-buy)' }}>
                  TP ${p.suggestedTakeProfitPrice.toFixed(2)}
                </div>
                <div style={{ color: 'var(--color-sell)' }}>
                  SL ${p.suggestedStopLossPrice.toFixed(2)}
                </div>
                <div style={{ color: 'var(--color-fg-muted)', marginTop: 2 }}>
                  {fmtTtl(p.expiresAt)}
                </div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
