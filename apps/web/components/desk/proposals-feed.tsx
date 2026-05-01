'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import type { DemoProposalShape } from '@hunch-it/shared';
import { useProposals } from '@/lib/hooks/queries';
import { useProposalsStore } from '@/lib/store/proposals';
import { fmtUsd } from '@/lib/utils/fmt';
import { useMemo } from 'react';

function timeUntil(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `Expires in ${hours}h ${minutes}m`;
}

/**
 * Live proposals feed for /desk. Merges:
 *   - useProposals() — server-side ACTIVE proposals (TanStack Query, 30s
 *     refetch, also invalidated by skip / execute mutations)
 *   - useProposalsStore — push-driven proposals from the Socket.IO
 *     `proposal:new` stream (wins on tie since it's fresher)
 */
export function ProposalsFeed() {
  const { data, isLoading, error } = useProposals();
  const order = useProposalsStore((s) => s.order);
  const proposalsById = useProposalsStore((s) => s.proposalsById);

  const proposals = useMemo<DemoProposalShape[]>(() => {
    const seen = new Set<string>();
    const out: DemoProposalShape[] = [];
    for (const id of order) {
      const p = proposalsById[id];
      if (!p || seen.has(p.id)) continue;
      out.push(p);
      seen.add(p.id);
    }
    for (const p of data?.proposals ?? []) {
      if (seen.has(p.id)) continue;
      out.push(p);
      seen.add(p.id);
    }
    return out.sort(
      (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
    );
  }, [order, proposalsById, data]);

  return (
    <motion.section
      className="mt-8 flex flex-col gap-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <h3 className="text-title-lg text-primary mb-2">Action Required</h3>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          <div className="bg-surface rounded-lg p-5 h-[180px] animate-pulse shadow-micro" />
          <div className="bg-surface rounded-lg p-4 h-[140px] animate-pulse shadow-micro" />
        </div>
      ) : error ? (
        <div className="bg-surface rounded-lg p-6 shadow-micro flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-negative-container flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-negative text-[24px]">cloud_off</span>
          </div>
          <p className="text-title-md text-on-surface">Unable to load proposals</p>
          <p className="text-body-sm text-on-surface-variant mt-1">Pull to refresh.</p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="bg-surface rounded-lg p-6 shadow-micro flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-primary text-[24px]">task_alt</span>
          </div>
          <p className="text-title-md text-primary">Desk is clear.</p>
          <p className="text-body-sm text-on-surface-variant mt-1">
            No pending proposals at this time.
          </p>
        </div>
      ) : (
        <>
          {proposals[0] && (() => {
            const hero = proposals[0];
            return (
              <Link href={`/proposals/${hero.id}`} className="block">
                <div className="relative overflow-hidden bg-accent rounded-lg p-5 shadow-soft">
                  <div className="absolute -top-10 -right-10 w-40 h-40 bg-surface/30 blur-3xl rounded-full pointer-events-none" />
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-11 h-11 bg-primary text-on-primary rounded-full">
                          <span className="material-symbols-outlined text-[24px]">
                            {hero.action === 'SELL' ? 'trending_down' : 'trending_up'}
                          </span>
                        </div>
                        <div>
                          <div className="text-label-lg text-primary">
                            {hero.ticker} {hero.action}
                          </div>
                          <div className="text-body-sm text-primary/80">
                            {Math.round(hero.confidence * 100)}% Confidence
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-surface/20 text-primary">
                        <span className="material-symbols-outlined text-[18px]">bolt</span>
                      </div>
                    </div>
                    <p className="text-body-md text-primary mb-6 font-medium line-clamp-2">
                      {hero.rationale}
                    </p>
                    <div className="flex gap-3">
                      <span className="flex-1 bg-primary text-on-primary rounded-full py-3 text-label-lg font-semibold text-center">
                        Review
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })()}

          {proposals.slice(1).map((proposal) => (
            <div key={proposal.id} className="bg-surface rounded-lg p-4 shadow-micro">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <div className="bg-accent text-on-accent text-label-md px-2 py-1 rounded-full font-bold">
                    {proposal.action}
                  </div>
                  <div>
                    <div className="text-label-lg text-on-surface">{proposal.ticker}</div>
                    <div className="text-body-sm text-on-surface-variant flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">schedule</span>
                      {timeUntil(proposal.expiresAt)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-end mt-4">
                <div>
                  <div className="text-body-sm text-on-surface-variant mb-1">Suggested Size</div>
                  <div className="text-title-md text-on-surface">
                    {fmtUsd(proposal.suggestedSizeUsd, { digits: 0 })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-body-sm text-on-surface-variant mb-1">Targets</div>
                  <div className="text-label-md text-on-surface">
                    TP {fmtUsd(proposal.suggestedTakeProfitPrice)} / SL {fmtUsd(proposal.suggestedStopLossPrice)}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-divider">
                <Link
                  href={`/proposals/${proposal.id}`}
                  className="flex items-center justify-center w-full text-label-lg text-primary py-2 hover:bg-surface-dim rounded-full transition-colors"
                >
                  Review Details
                </Link>
              </div>
            </div>
          ))}
        </>
      )}
    </motion.section>
  );
}
