'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

function timeUntil(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `Expires in ${hours}h ${minutes}m`;
}

interface MockProposal {
  id: string;
  assetId: string;
  action: string;
  confidence: number;
  rationale: string;
  expiresAt: string;
  suggestedSizeUsd: number;
  suggestedTakeProfitPrice: number;
  suggestedStopLossPrice: number;
  ticker?: string;
  name?: string;
}

// TODO(integration): Fetch proposals from API
export function ProposalsFeed() {
  const isLoading = false;
  const error = null;
  const proposals: MockProposal[] = [
    {
      id: 'p1',
      assetId: 'sol',
      action: 'BUY',
      confidence: 0.95,
      rationale: 'Strong bullish divergence detected on the 4H timeframe.',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
      suggestedSizeUsd: 2500,
      suggestedTakeProfitPrice: 150,
      suggestedStopLossPrice: 130,
      ticker: 'SOL',
      name: 'Solana',
    },
    {
      id: 'p2',
      assetId: 'jup',
      action: 'SELL',
      confidence: 0.82,
      rationale: 'Approaching major resistance level with declining volume.',
      expiresAt: new Date(Date.now() + 1000 * 60 * 45).toISOString(),
      suggestedSizeUsd: 1000,
      suggestedTakeProfitPrice: 0.9,
      suggestedStopLossPrice: 1.1,
      ticker: 'JUP',
      name: 'Jupiter',
    }
  ];

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
          <button
            onClick={() => {}}
            className="mt-4 px-5 py-2.5 bg-primary text-on-primary rounded-full text-label-md active:scale-[0.97] transition-transform"
          >
            Retry
          </button>
        </div>
      ) : !proposals || proposals.length === 0 ? (
        <div className="bg-surface rounded-lg p-6 shadow-micro flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-primary text-[24px]">task_alt</span>
          </div>
          <p className="text-title-md text-primary">Desk is clear.</p>
          <p className="text-body-sm text-on-surface-variant mt-1">No pending proposals at this time.</p>
        </div>
      ) : (
        <>
          {proposals[0] && (() => {
            const hero = proposals[0];
            const ticker = hero.ticker ? `${hero.ticker}x` : hero.assetId;
            return (
              <Link href={`/proposals/${hero.id}`} className="block">
                <div className="relative overflow-hidden bg-accent rounded-lg p-5 shadow-soft">
                  <div className="absolute -top-10 -right-10 w-40 h-40 bg-surface/30 blur-3xl rounded-full pointer-events-none" />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-11 h-11 bg-primary text-on-primary rounded-full">
                          <span className="material-symbols-outlined text-[24px]">trending_up</span>
                        </div>
                        <div>
                          <div className="text-label-lg text-primary">{ticker} {hero.action}</div>
                          <div className="text-body-sm text-primary/80">{Math.round(hero.confidence * 100)}% Confidence</div>
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

          {proposals.slice(1).map((proposal) => {
            const ticker = proposal.ticker ? `${proposal.ticker}x` : proposal.assetId;
            const name = proposal.name ?? proposal.assetId;

            return (
              <div key={proposal.id} className="bg-surface rounded-lg p-4 shadow-micro">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-accent text-on-accent text-label-md px-2 py-1 rounded-full font-bold">
                      {proposal.action}
                    </div>
                    <div>
                      <div className="text-label-lg text-on-surface">{ticker} · {name}</div>
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
                    <div className="text-title-md text-on-surface">${proposal.suggestedSizeUsd.toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-body-sm text-on-surface-variant mb-1">Targets</div>
                    <div className="text-label-md text-on-surface">
                      TP ${proposal.suggestedTakeProfitPrice.toLocaleString()} / SL ${proposal.suggestedStopLossPrice.toLocaleString()}
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-divider">
                  <Link href={`/proposals/${proposal.id}`} className="flex items-center justify-center w-full text-label-lg text-primary py-2 hover:bg-surface-dim rounded-full transition-colors">
                    Review Details
                  </Link>
                </div>
              </div>
            );
          })}
        </>
      )}
    </motion.section>
  );
}
