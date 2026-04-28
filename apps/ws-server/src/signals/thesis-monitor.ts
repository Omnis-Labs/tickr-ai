// Thesis-monitor — every 5 minutes, walks every user's ACTIVE Position and
// re-evaluates the thesis tags from its originating BUY Proposal against
// the current indicator snapshot. When a majority of the original tags
// have flipped false, emit a SELL Proposal so the user can decide whether
// to exit.
//
// Conservative on duplicates:
//   - skip a position if it already has an ACTIVE SELL Proposal
//   - skip if the originating BUY had no thesisTags (legacy data)
//
// The Proposal Generator is the source of truth for which tags were true
// at BUY-time; this module never re-derives them from the BUY's indicator
// snapshot, which would defeat the point.

import type { PrismaClient } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import {
  WsServerEvents,
  evaluateThesis,
  xStockToBare,
  type BareTicker,
} from '@hunch-it/shared';
import { computeIndicators } from './indicators.js';
import { getHistoricalBars } from '../pyth/benchmarks.js';
import { getLatestPrice } from '../pyth/index.js';

export interface ThesisMonitorSummary {
  positionsChecked: number;
  sellsEmitted: number;
  errors: number;
}

const SELL_TTL_MIN = 30; // SELL proposal expiry, mirrors BUY behavior

interface CurrentSnapshotCache {
  bareTicker: BareTicker;
  rsi: number;
  ma20: number;
  ma50: number;
  price: number;
  macd: { macd: number; signal: number; histogram: number };
}

async function getCurrentSnapshot(
  bareTicker: BareTicker,
): Promise<CurrentSnapshotCache | null> {
  try {
    const [bars, snap] = await Promise.all([
      getHistoricalBars(bareTicker, '5', 24),
      getLatestPrice(bareTicker),
    ]);
    if (bars.length < 20 || !snap) return null;
    const ind = await computeIndicators(bars);
    return {
      bareTicker,
      rsi: ind.rsi14,
      ma20: ind.ma20,
      ma50: ind.ma50,
      price: snap.price,
      macd: ind.macd,
    };
  } catch (err) {
    console.warn(`[thesis] snapshot ${bareTicker} failed`, err);
    return null;
  }
}

export async function runThesisMonitor(
  prisma: PrismaClient,
  io: IoServer,
): Promise<ThesisMonitorSummary> {
  const summary: ThesisMonitorSummary = {
    positionsChecked: 0,
    sellsEmitted: 0,
    errors: 0,
  };

  const positions = await prisma.position.findMany({
    where: { state: { in: ['ACTIVE', 'ENTERING'] } },
    include: {
      user: { select: { id: true, walletAddress: true } },
      proposals: {
        where: { action: 'BUY' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (positions.length === 0) return summary;

  // Cache snapshots per ticker to avoid repeated Pyth calls.
  const snapshotCache = new Map<string, CurrentSnapshotCache | null>();

  for (const position of positions) {
    summary.positionsChecked++;
    try {
      const buyProposal = position.proposals[0];
      if (!buyProposal) continue;
      const tags = (buyProposal.thesisTags ?? []) as string[];
      if (!Array.isArray(tags) || tags.length === 0) continue;

      // Don't double-emit a SELL while one is still ACTIVE for this position.
      const existingSell = await prisma.proposal.findFirst({
        where: {
          positionId: position.id,
          action: 'SELL',
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (existingSell) continue;

      // Resolve assetId → BareTicker for the indicator pull.
      let bareTicker: BareTicker;
      try {
        bareTicker = xStockToBare(position.ticker as Parameters<typeof xStockToBare>[0]);
      } catch {
        continue; // crypto / unknown — no indicators available yet
      }

      let snap = snapshotCache.get(bareTicker);
      if (snap === undefined) {
        snap = await getCurrentSnapshot(bareTicker);
        snapshotCache.set(bareTicker, snap);
      }
      if (!snap) continue;

      const evaluation = evaluateThesis(tags, snap);
      if (!evaluation.shouldExit) continue;

      // Emit SELL Proposal. Use the BUY's reasoning verbatim for
      // "originally we said …" context; the new field carries the
      // invalidation summary.
      const invalidatedLabels = evaluation.invalidated
        .map((id) => {
          const tag = tags.find((t) => t === id);
          return tag;
        })
        .filter(Boolean)
        .join(', ');

      const created = await prisma.proposal.create({
        data: {
          userId: position.user!.id,
          ticker: position.ticker,
          action: 'SELL',
          // Reuse the BUY's price targets so the schema stays uniform; the
          // SELL modal doesn't surface them.
          suggestedSizeUsd: buyProposal.suggestedSizeUsd,
          suggestedTriggerPrice: snap.price,
          suggestedTakeProfitPrice: buyProposal.suggestedTakeProfitPrice,
          suggestedStopLossPrice: buyProposal.suggestedStopLossPrice,
          rationale: `${evaluation.invalidated.length}/${evaluation.originalCount} of the original BUY thesis tags have flipped: ${invalidatedLabels}`,
          reasoning: {
            what_changed: `${evaluation.invalidated.length} of ${evaluation.originalCount} thesis conditions are no longer true.`,
            why_this_trade: `Original BUY relied on ${evaluation.originalCount} structured tags; the conservative majority threshold has been crossed.`,
            why_fits_mandate: `Per your mandate, exiting when the thesis weakens caps drawdown ahead of the SL price.`,
          },
          positionImpact: buyProposal.positionImpact ?? {},
          confidence: 0.7,
          priceAtProposal: snap.price,
          indicators: {
            rsi: snap.rsi,
            macd: snap.macd,
            ma20: snap.ma20,
            ma50: snap.ma50,
          },
          thesisTags: evaluation.invalidated,
          sourceBuyProposalId: buyProposal.id,
          positionId: position.id,
          triggeringTag: evaluation.triggeringTag,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + SELL_TTL_MIN * 60_000),
        },
      });

      io.to(`user:${position.user!.walletAddress}`).emit(
        WsServerEvents.ProposalNew,
        {
          id: created.id,
          userId: position.user!.id,
          ticker: position.ticker,
          action: 'SELL',
          suggestedSizeUsd: created.suggestedSizeUsd.toNumber(),
          suggestedTriggerPrice: created.suggestedTriggerPrice.toNumber(),
          suggestedTakeProfitPrice: created.suggestedTakeProfitPrice.toNumber(),
          suggestedStopLossPrice: created.suggestedStopLossPrice.toNumber(),
          rationale: created.rationale,
          reasoning: created.reasoning,
          positionImpact: created.positionImpact,
          confidence: created.confidence.toNumber(),
          priceAtProposal: created.priceAtProposal.toNumber(),
          indicators: created.indicators,
          thesisTags: created.thesisTags,
          sourceBuyProposalId: created.sourceBuyProposalId,
          positionId: created.positionId,
          triggeringTag: created.triggeringTag,
          status: created.status,
          expiresAt: created.expiresAt.toISOString(),
          createdAt: created.createdAt.toISOString(),
        },
      );

      summary.sellsEmitted++;
      console.log(
        `[thesis] SELL ${position.ticker} for ${position.user!.walletAddress.slice(0, 6)}… — ${evaluation.invalidated.length}/${evaluation.originalCount} tags invalidated, trigger=${evaluation.triggeringTag}`,
      );
    } catch (err) {
      console.warn(`[thesis] check ${position.id} failed`, err);
      summary.errors++;
    }
  }

  return summary;
}
