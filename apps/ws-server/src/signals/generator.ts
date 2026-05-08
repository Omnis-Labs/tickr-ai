import { randomUUID } from 'node:crypto';
import {
  MIN_ACTIONABLE_CONFIDENCE,
  SIGNAL_TTL_DEFAULT,
  WsServerEvents,
  getSignalAssets,
  type IndicatorSnapshot,
  type Signal,
} from '@hunch-it/shared';
import type { Server as IoServer } from 'socket.io';
import { getPrisma, persistSignal } from '../db/index.js';
import { env } from '../env.js';
import { getHistoricalBars } from '../pyth/benchmarks.js';
import { evaluateFreshness, getLatestPrice } from '../pyth/index.js';
import { computeIndicators, type IndicatorResult } from './indicators.js';
import { generateLlmSignal } from './llm.js';
import {
  generateProposalsForBaseAnalysis,
  type BaseAnalysis,
} from './proposal-generator.js';

function toIndicatorSnapshot(r: IndicatorResult): IndicatorSnapshot {
  return {
    rsi: r.rsi14,
    macd: { macd: r.macd.macd, signal: r.macd.signal, histogram: r.macd.histogram },
    ma20: r.ma20,
    ma50: r.ma50,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface GenerateOptions {
  assetId?: string;
  forceEmit?: boolean; // bypass MIN_ACTIONABLE_CONFIDENCE / HOLD filter
}

/**
 * Pulls real Pyth + bars + indicators + LLM for a ticker, persists, and returns
 * the constructed Signal. Throws if upstream Pyth fails so callers can decide
 * whether to skip or surface.
 */
export async function generateSignal(opts: GenerateOptions = {}): Promise<Signal | null> {
  const assetId = opts.assetId ?? pickRandomAssetId();

  const snap = await getLatestPrice(assetId);
  if (!snap) {
    console.warn(`[gen] ${assetId} no Pyth snapshot`);
    return null;
  }
  const verdict = evaluateFreshness(snap);
  if (!verdict.fresh) {
    console.log(`[gen] ${assetId} skipped: ${verdict.reason}`);
    return null;
  }

  const bars = await getHistoricalBars(assetId, '5', 24);
  if (bars.length < 50) {
    console.warn(`[gen] ${assetId} insufficient bars (${bars.length} < 50)`);
    return null;
  }

  const indicators = await computeIndicators(bars);

  const llm = await generateLlmSignal({
    assetId,
    currentPrice: snap.price,
    bars,
    indicators,
  });

  if (
    !opts.forceEmit &&
    (llm.signal.action === 'HOLD' || llm.signal.confidence < MIN_ACTIONABLE_CONFIDENCE)
  ) {
    console.log(
      `[gen] ${assetId} not actionable: ${llm.signal.action} conf=${llm.signal.confidence.toFixed(2)}${llm.degraded ? ' (degraded)' : ''}`,
    );
    return null;
  }

  const now = Date.now();
  const ttl = llm.signal.ttl_seconds ?? SIGNAL_TTL_DEFAULT;
  const signal: Signal = {
    id: randomUUID(),
    ticker: assetId,
    action: llm.signal.action,
    confidence: llm.signal.confidence,
    rationale: llm.signal.rationale,
    ttlSeconds: ttl,
    priceAtSignal: snap.price,
    indicators: toIndicatorSnapshot(indicators),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl * 1000).toISOString(),
    degraded: llm.degraded,
  };

  await persistSignal(signal);
  return signal;
}

export async function emitSignal(io: IoServer, assetId?: string): Promise<Signal | null> {
  const signal = await generateSignal({ assetId });
  if (!signal) return null;
  io.emit(WsServerEvents.SignalNew, signal);
  console.log(
    `[signal] emitted ${signal.ticker} ${signal.action} conf=${signal.confidence.toFixed(2)}${signal.degraded ? ' (degraded)' : ''} id=${signal.id}`,
  );

  // v1.3 Stage 2: hand the base analysis to the per-user Proposal Generator,
  // which writes Proposal rows for every matching mandate and emits per-user.
  if (signal.action === 'BUY') {
    const prisma = getPrisma();
    if (prisma) {
      const baseAnalysis: BaseAnalysis = {
        assetId: signal.ticker,
        action: 'BUY',
        confidence: signal.confidence,
        rationale: signal.rationale,
        // Phase E: the legacy LLM path in llm.ts only returns a one-line
        // rationale, so what_changed / why_this_trade are stubs derived from
        // it. Phase E+ will rework the LLM prompt to return all three.
        what_changed: signal.rationale,
        why_this_trade: signal.rationale,
        priceAtAnalysis: signal.priceAtSignal,
        // Default TP/SL bands until the LLM emits them directly.
        suggestedTpPct: 0.04,
        suggestedSlPct: 0.025,
        indicators: {
          rsi: signal.indicators.rsi ?? 50,
          macd: signal.indicators.macd ?? { macd: 0, signal: 0, histogram: 0 },
          ma20: signal.indicators.ma20 ?? signal.priceAtSignal,
          ma50: signal.indicators.ma50 ?? signal.priceAtSignal,
        },
      };
      try {
        const s = await generateProposalsForBaseAnalysis(prisma, io, baseAnalysis);
        if (s.proposalsCreated > 0 || s.errors > 0) {
          console.log(
            `[gen2] ${signal.ticker} matchingUsers=${s.matchingUsers} proposals=${s.proposalsCreated} errors=${s.errors}`,
          );
        }
      } catch (err) {
        console.warn(`[gen2] ${signal.ticker} fan-out failed`, err);
      }
    }
  }

  return signal;
}

function pickRandomAssetId(): string {
  const assets = getSignalAssets();
  const idx = Math.floor(Math.random() * assets.length);
  return assets[idx]?.assetId ?? 'AAPLx';
}

/**
 * Long-running loop that walks the full signal asset list every `intervalSeconds`.
 * Assets are processed sequentially with `staggerSeconds` between each call
 * so we don't burst Hermes / Gemini.
 */
export function startSignalLoop(io: IoServer): () => void {
  const intervalSeconds = env.SIGNAL_INTERVAL_SECONDS;
  const staggerSeconds = env.TICKER_STAGGER_SECONDS;
  let stopped = false;

  async function tick() {
    for (const asset of getSignalAssets()) {
      if (stopped) return;
      try {
        await emitSignal(io, asset.assetId);
      } catch (err) {
        console.warn(`[gen] ${asset.assetId} cycle failed`, err);
      }
      if (staggerSeconds > 0) await sleep(staggerSeconds * 1000);
    }
  }

  console.log(
    `[signal] loop running interval=${intervalSeconds}s stagger=${staggerSeconds}s assets=${getSignalAssets().length}`,
  );
  // Kick off immediately, then every intervalSeconds.
  void tick();
  const handle = setInterval(() => {
    void tick();
  }, intervalSeconds * 1000);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
