// Proposal Generator (live mode).
//
// Given a Base Market Analysis for an asset (from the Signal Engine),
// queries every user whose mandate market_focus contains this asset, builds
// a personalized Proposal (size scaled by wallet USDC + mandate.maxTradeSize,
// TP/SL bands scaled by mandate.maxDrawdown + holdingPeriod, mandate-aware reasoning),
// persists each row in Postgres, and emits proposal:new into the user room.
//
// This is what makes the same NVDAx market move produce different proposals
// for different users (PRD §Per-user Signal Problem).

import type { PrismaClient } from '@hunch-it/db';
import { createBuyProposalForUser } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import {
  WsServerEvents,
  type BaseMarketAnalysis,
  getMarketFocusVerticalsForAsset,
  getSignalAssetIdsForVerticals,
} from '@hunch-it/shared';
import { computePositionImpact } from './portfolio-context.js';
import { getLatestPrices } from '../pyth/index.js';

export type BaseAnalysis = BaseMarketAnalysis;

export interface ProposalGeneratorSummary {
  matchingUsers: number;
  proposalsCreated: number;
  errors: number;
}

/**
 * Walks live users with matching mandates, builds & persists per-user proposals.
 * Returns summary; caller logs.
 */
export async function generateProposalsForBaseAnalysis(
  prisma: PrismaClient,
  io: IoServer,
  base: BaseAnalysis,
): Promise<ProposalGeneratorSummary> {
  const summary: ProposalGeneratorSummary = {
    matchingUsers: 0,
    proposalsCreated: 0,
    errors: 0,
  };
  if (base.action !== 'BUY' || base.confidence < 0.7) return summary;

  const verticals = getMarketFocusVerticalsForAsset(base.assetId);
  if (verticals.length === 0) return summary;

  // The set of asset ids that share at least one vertical with this asset —
  // used for sector aggregation in positionImpact. Built once.
  const sectorPeerArr = Array.from(getSignalAssetIdsForVerticals(verticals));
  const now = new Date();

  // Find users whose mandate's market_focus overlaps this asset's verticals,
  // OR who chose "no_preference".
  const users = await prisma.user.findMany({
    where: {
      mandate: {
        OR: [
          { marketFocus: { array_contains: ['no_preference'] } },
          ...verticals.map((v) => ({ marketFocus: { array_contains: [v] } })),
        ],
      },
    },
    include: {
      mandate: true,
      // Skip users who already have an open position on this asset (avoid pile-on).
      positions: {
        where: { ticker: base.assetId, state: { not: 'CLOSED' } },
        select: { id: true },
      },
      // Skip users who already have a live BUY proposal for this asset. The
      // signal loop can refresh the same bullish setup repeatedly; the user
      // should see one active decision, not a stack of near-identical cards.
      proposals: {
        where: {
          ticker: base.assetId,
          action: 'BUY',
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        select: { id: true },
      },
    },
  });
  summary.matchingUsers = users.length;

  const eligibleUsers = users.filter(
    (user) => user.mandate && user.positions.length === 0 && user.proposals.length === 0,
  );
  if (eligibleUsers.length === 0) return summary;

  // Pre-fetch one Pyth snapshot for every signal asset so positionImpact can mark
  // the user's other holdings to current price. Single round-trip up front
  // beats N+1 per user.
  const allMarks = await getLatestPrices().catch(() => new Map());
  const marksByAssetId = new Map<string, number>();
  for (const [assetId, snap] of allMarks) marksByAssetId.set(assetId, snap.price);

  for (const user of eligibleUsers) {
    if (!user.mandate) continue;

    try {
      const mandate = user.mandate;
      // Mandate.maxTradeSize / maxDrawdown are Prisma.Decimal; convert once
      // for the local arithmetic. USD pennies of error are fine here.
      const maxTradeSize = mandate.maxTradeSize.toNumber();
      const maxDrawdown = mandate.maxDrawdown?.toNumber() ?? null;

      // Real positionImpact via on-chain balance read. Falls back to zeros
      // if the RPC call fails so a single user's RPC outage doesn't take
      // down the whole proposal generation tick. A zero-cash fallback means
      // ProposalCreation will decline to create a BUY proposal for that user.
      const ctx = await computePositionImpact({
        walletAddress: user.walletAddress,
        assetId: base.assetId,
        sameVerticalAssetIds: sectorPeerArr,
        marksByAssetId,
      });

      const created = await createBuyProposalForUser(prisma, {
        userId: user.id,
        analysis: base,
        mandate: {
          holdingPeriod: mandate.holdingPeriod,
          maxTradeSizeUsd: maxTradeSize,
          maxDrawdown,
        },
        positionImpact: {
          totalUsd: ctx.totalUsd,
          cashUsd: ctx.cashUsd,
          assetExposureUsd: ctx.tickerExposureUsd,
          verticalExposureUsd: ctx.sectorExposureUsd,
        },
      });
      if (!created) continue;

      io.to(`user:${user.walletAddress}`).emit(WsServerEvents.ProposalNew, {
        ...created,
        // serialize Date fields the way the client expects
        expiresAt: created.expiresAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
      });
      summary.proposalsCreated++;
    } catch (err) {
      console.warn(`[gen2] user=${user.walletAddress.slice(0, 6)}… failed`, err);
      summary.errors++;
    }
  }

  return summary;
}
