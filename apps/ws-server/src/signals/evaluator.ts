// Back-evaluation cron — every 5 minutes.
//
// Spec §Back-evaluation:
//   1. find Proposals where evaluatedAt IS NULL and createdAt + 1h < now()
//   2. fetch the price 1h after createdAt from Pyth Benchmarks
//   3. compute pctChange vs priceAtProposal
//   4. classify WIN / LOSS / NEUTRAL and write back
//
// This drives signal-quality monitoring + future leaderboard. v1.3 only emits
// BUY proposals so a price increase = WIN.

import type { PrismaClient } from '@hunch-it/db';
import { BARE_TICKERS, type BareTicker } from '@hunch-it/shared';
import { getBarsRange } from '../pyth/benchmarks.js';

export interface EvaluationSummary {
  evaluated: number;
  skipped: number;
  errors: number;
}

// A move bigger than ±0.5% over 1h on US equities is non-trivial enough to
// call WIN / LOSS. Anything tighter is noise → NEUTRAL.
const WIN_THRESHOLD_PCT = 0.5;

function classify(
  pctChange: number,
  action: 'BUY' | 'SELL' | 'HOLD',
): 'WIN' | 'LOSS' | 'NEUTRAL' {
  if (Math.abs(pctChange) < WIN_THRESHOLD_PCT) return 'NEUTRAL';
  // BUY: a price rise after the proposal = correct call.
  if (action === 'BUY') return pctChange > 0 ? 'WIN' : 'LOSS';
  // SELL (thesis-monitor): a price drop after the alert = correct call,
  // because the user would have lost money holding. Inverted from BUY.
  if (action === 'SELL') return pctChange < 0 ? 'WIN' : 'LOSS';
  return 'NEUTRAL';
}

/**
 * Find the Pyth bar whose timestamp is closest to `targetUnix`. The
 * benchmarks API returns bars at the resolution we asked for; we scan a
 * narrow ±15min window and pick the nearest close. Returns null if Pyth
 * has no data (weekend / holiday / pre-market).
 */
async function priceAtTime(
  ticker: BareTicker,
  targetUnix: number,
): Promise<number | null> {
  const windowSec = 15 * 60;
  const bars = await getBarsRange(
    ticker,
    '5',
    targetUnix - windowSec,
    targetUnix + windowSec,
  );
  if (bars.length === 0) return null;
  let best = bars[0]!;
  let bestDelta = Math.abs(best.time - targetUnix);
  for (const b of bars) {
    const d = Math.abs(b.time - targetUnix);
    if (d < bestDelta) {
      best = b;
      bestDelta = d;
    }
  }
  return best.close;
}

export async function evaluatePendingSignals(
  prisma: PrismaClient,
): Promise<EvaluationSummary> {
  const summary: EvaluationSummary = { evaluated: 0, skipped: 0, errors: 0 };

  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const pending = await prisma.proposal.findMany({
    where: {
      evaluatedAt: null,
      createdAt: { lte: cutoff },
    },
    take: 200,
    orderBy: { createdAt: 'asc' },
  });
  if (pending.length === 0) return summary;

  for (const p of pending) {
    try {
      const bare = (p.ticker.endsWith('x') ? p.ticker.slice(0, -1) : p.ticker) as BareTicker;
      if (!BARE_TICKERS.includes(bare)) {
        // Unknown ticker — mark NEUTRAL with no price data so we don't keep
        // re-querying it every tick.
        await prisma.proposal.update({
          where: { id: p.id },
          data: {
            evaluatedAt: new Date(),
            outcome: 'NEUTRAL',
          },
        });
        summary.skipped++;
        continue;
      }

      const targetUnix = Math.floor(p.createdAt.getTime() / 1000) + 3600;
      const priceAfter = await priceAtTime(bare, targetUnix);
      if (priceAfter == null) {
        // Pyth gave us no bar near the target — most likely the proposal
        // landed outside US market hours. Mark NEUTRAL so the leaderboard
        // doesn't stall, but flag with no priceAfter so we know it's a
        // closed-market evaluation.
        await prisma.proposal.update({
          where: { id: p.id },
          data: {
            evaluatedAt: new Date(),
            priceAfter: null,
            pctChange: null,
            outcome: 'NEUTRAL',
          },
        });
        summary.skipped++;
        continue;
      }

      // p.priceAtProposal is Prisma.Decimal — cast to number for the simple
      // pct-change calc. We don't need Decimal precision for a 1h % move.
      const priceAt = p.priceAtProposal.toNumber();
      const pctChange =
        priceAt > 0 ? ((priceAfter - priceAt) / priceAt) * 100 : 0;
      const outcome = classify(pctChange, p.action as 'BUY' | 'SELL' | 'HOLD');

      await prisma.proposal.update({
        where: { id: p.id },
        data: {
          evaluatedAt: new Date(),
          priceAfter,
          pctChange,
          outcome,
        },
      });
      summary.evaluated++;
    } catch (err) {
      console.warn(`[eval] proposal ${p.id} failed`, err);
      summary.errors++;
    }
  }

  return summary;
}
