// Stage 2 Proposal Generator (live mode).
//
// Given a base LLM analysis for a ticker (from Stage 1 / Market Scanner),
// queries every user whose mandate market_focus contains this ticker, builds
// a personalized Proposal (size scaled by mandate.maxTradeSize, TP/SL bands
// scaled by mandate.maxDrawdown + holdingPeriod, mandate-aware reasoning),
// persists each row in Postgres, and emits proposal:new into the user room.
//
// This is what makes the same NVDAx market move produce different proposals
// for different users (PRD §Per-user Signal Problem).

import type { PrismaClient } from '@hunch-it/db';
import type { Server as IoServer } from 'socket.io';
import {
  MARKET_FOCUS_VERTICALS,
  WsServerEvents,
  bareToXStock,
  extractThesisTags,
  xStockToBare,
  type BareTicker,
} from '@hunch-it/shared';
import { computePositionImpact } from './portfolio-context.js';
import { getLatestPrices } from '../pyth/index.js';

export interface BaseAnalysis {
  bareTicker: BareTicker;
  action: 'BUY' | 'HOLD';
  confidence: number; // 0-1
  rationale: string;
  what_changed: string;
  why_this_trade: string;
  priceAtAnalysis: number;
  /** Suggested TP as a percentage above entry (e.g. 0.04 = +4%). */
  suggestedTpPct: number;
  /** Suggested SL as a percentage below entry. */
  suggestedSlPct: number;
  indicators: {
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
    ma20: number;
    ma50: number;
  };
}

export interface ProposalGeneratorSummary {
  matchingUsers: number;
  proposalsCreated: number;
  errors: number;
}

const HOLDING_PERIOD_TO_TTL_MIN: Record<string, number> = {
  '1-3 days': 30,
  '1-2 weeks': 90,
  '1-3 months': 180,
  '6+ months': 240,
};

function tickerVerticals(symbol: string): string[] {
  const out: string[] = [];
  for (const v of MARKET_FOCUS_VERTICALS) {
    if (v.tickers.includes(symbol)) out.push(v.id);
  }
  return out;
}

function clampSize(maxTradeSize: number, baseSize: number): number {
  return Math.max(20, Math.min(maxTradeSize, baseSize));
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

  const symbol = bareToXStock(base.bareTicker); // "NVDA" → "NVDAx"
  const verticals = tickerVerticals(symbol);
  if (verticals.length === 0) return summary;

  // Pre-fetch one Pyth snapshot for every xStock so positionImpact can mark
  // the user's other holdings to current price. Single round-trip up front
  // beats N+1 per user.
  const allMarks = await getLatestPrices().catch(() => new Map());
  const marksByBareTicker = new Map<BareTicker, number>();
  for (const [ticker, snap] of allMarks) marksByBareTicker.set(ticker, snap.price);

  // The set of bare tickers that share at least one vertical with `symbol` —
  // used for sector aggregation in positionImpact. Built once.
  const sectorPeers = new Set<BareTicker>();
  for (const v of MARKET_FOCUS_VERTICALS) {
    if (!verticals.includes(v.id)) continue;
    for (const t of v.tickers) {
      if (typeof t === 'string' && t.endsWith('x')) {
        const bare = xStockToBare(t as Parameters<typeof xStockToBare>[0]);
        sectorPeers.add(bare);
      }
    }
  }
  const sectorPeerArr = Array.from(sectorPeers);

  // Find users whose mandate's market_focus overlaps this ticker's verticals,
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
      // Skip users who already have an open position on this ticker (avoid pile-on).
      positions: {
        where: { ticker: symbol, state: { not: 'CLOSED' } },
        select: { id: true },
      },
    },
  });
  summary.matchingUsers = users.length;

  for (const user of users) {
    if (!user.mandate) continue;
    if (user.positions.length > 0) continue; // already exposed

    try {
      const mandate = user.mandate;
      // Mandate.maxTradeSize / maxDrawdown are Prisma.Decimal; convert once
      // for the local arithmetic. USD pennies of error are fine here.
      const maxTradeSize = mandate.maxTradeSize.toNumber();
      const maxDrawdown = mandate.maxDrawdown?.toNumber() ?? null;
      const baseSize = maxTradeSize * 0.4; // 40% of max as default
      const sizeUsd = clampSize(maxTradeSize, Math.round(baseSize));
      const triggerPrice = +(base.priceAtAnalysis * 0.997).toFixed(2);
      const tpPrice = +(triggerPrice * (1 + base.suggestedTpPct)).toFixed(2);
      const drawdownCap = maxDrawdown ?? base.suggestedSlPct;
      const slPct = Math.min(base.suggestedSlPct, drawdownCap);
      const slPrice = +(triggerPrice * (1 - slPct)).toFixed(2);
      const ttlMin = HOLDING_PERIOD_TO_TTL_MIN[mandate.holdingPeriod] ?? 60;

      // Real positionImpact via on-chain balance read. Falls back to zeros
      // if the RPC call fails so a single user's RPC outage doesn't take
      // down the whole proposal generation tick.
      const ctx = await computePositionImpact({
        walletAddress: user.walletAddress,
        bareTicker: base.bareTicker,
        sameVerticalBareTickers: sectorPeerArr,
        marksByBareTicker,
      });
      const totalUsd = ctx.totalUsd;
      const weightBefore = totalUsd > 0 ? ctx.tickerExposureUsd / totalUsd : 0;
      const weightAfter = totalUsd > 0 ? (ctx.tickerExposureUsd + sizeUsd) / totalUsd : 0;
      const cashAfter = ctx.cashUsd - sizeUsd;
      const sectorBefore = totalUsd > 0 ? ctx.sectorExposureUsd / totalUsd : 0;
      const sectorAfter = totalUsd > 0 ? (ctx.sectorExposureUsd + sizeUsd) / totalUsd : 0;

      const why_fits_mandate =
        `Fits your ${mandate.holdingPeriod} holding period. ` +
        `Size $${sizeUsd} is within your $${maxTradeSize.toFixed(0)} max trade size. ` +
        `Suggested SL at $${slPrice} caps risk to ${(slPct * 100).toFixed(1)}%${
          maxDrawdown != null
            ? ` (within your ${(maxDrawdown * 100).toFixed(0)}% drawdown tolerance)`
            : ''
        }.`;

      const created = await prisma.proposal.create({
        data: {
          userId: user.id,
          ticker: symbol,
          action: 'BUY',
          suggestedSizeUsd: sizeUsd,
          suggestedTriggerPrice: triggerPrice,
          suggestedTakeProfitPrice: tpPrice,
          suggestedStopLossPrice: slPrice,
          rationale: base.rationale,
          reasoning: {
            what_changed: base.what_changed,
            why_this_trade: base.why_this_trade,
            why_fits_mandate,
          },
          positionImpact: {
            weight_before: +weightBefore.toFixed(4),
            weight_after: +weightAfter.toFixed(4),
            cash_after: +cashAfter.toFixed(2),
            sector_before: +sectorBefore.toFixed(4),
            sector_after: +sectorAfter.toFixed(4),
          },
          confidence: base.confidence,
          priceAtProposal: base.priceAtAnalysis,
          indicators: base.indicators,
          // Snapshot of structured thesis tags that are TRUE right now. The
          // thesis-monitor uses this set as the BUY-time baseline; once a
          // majority flip false it emits a SELL Proposal.
          thesisTags: extractThesisTags({
            rsi: base.indicators.rsi,
            ma20: base.indicators.ma20,
            ma50: base.indicators.ma50,
            price: base.priceAtAnalysis,
            macd: base.indicators.macd,
          }),
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + ttlMin * 60_000),
        },
      });

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
