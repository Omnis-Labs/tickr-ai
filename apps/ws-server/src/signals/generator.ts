import { randomUUID } from 'node:crypto';
import {
  MIN_ACTIONABLE_CONFIDENCE,
  WsServerEvents,
  baseMarketIndicatorsToSnapshot,
  getSignalAssets,
  type BaseMarketAnalysis,
  type Signal,
} from '@hunch-it/shared';
import type { Server as IoServer } from 'socket.io';
import { getPrisma, persistSignal } from '../db/index.js';
import { env } from '../env.js';
import { generateBaseMarketAnalysis } from './base-analysis.js';
import { generateProposalsForBaseAnalysis } from '../proposals/generator.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface GenerateOptions {
  assetId?: string;
  forceEmit?: boolean; // bypass MIN_ACTIONABLE_CONFIDENCE / HOLD filter
}

interface GeneratedSignal {
  signal: Signal;
  baseAnalysis: BaseMarketAnalysis;
}

function toSignal(input: {
  baseAnalysis: BaseMarketAnalysis;
  ttlSeconds: number;
  degraded: boolean;
}): Signal {
  const now = Date.now();
  return {
    id: randomUUID(),
    ticker: input.baseAnalysis.assetId,
    action: input.baseAnalysis.action,
    confidence: input.baseAnalysis.confidence,
    rationale: input.baseAnalysis.rationale,
    ttlSeconds: input.ttlSeconds,
    priceAtSignal: input.baseAnalysis.priceAtAnalysis,
    indicators: baseMarketIndicatorsToSnapshot(input.baseAnalysis.indicators),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.ttlSeconds * 1000).toISOString(),
    degraded: input.degraded,
  };
}

/**
 * Runs the signal-engine core for one asset, persists the legacy Signal event
 * row, and returns both the UI Signal and the user-agnostic Base Analysis.
 */
async function generateSignalBundle(opts: GenerateOptions = {}): Promise<GeneratedSignal | null> {
  const assetId = opts.assetId ?? pickRandomAssetId();

  const generated = await generateBaseMarketAnalysis(assetId);
  if (!generated) return null;
  const { analysis } = generated;

  if (
    !opts.forceEmit &&
    (analysis.action === 'HOLD' || analysis.confidence < MIN_ACTIONABLE_CONFIDENCE)
  ) {
    console.log(
      `[gen] ${assetId} not actionable: ${analysis.action} conf=${analysis.confidence.toFixed(2)}${generated.degraded ? ' (degraded)' : ''}`,
    );
    return null;
  }

  const signal = toSignal({
    baseAnalysis: analysis,
    ttlSeconds: generated.ttlSeconds,
    degraded: generated.degraded,
  });
  await persistSignal(signal);
  return { signal, baseAnalysis: analysis };
}

export async function generateSignal(opts: GenerateOptions = {}): Promise<Signal | null> {
  const generated = await generateSignalBundle(opts);
  return generated?.signal ?? null;
}

export async function emitSignal(io: IoServer, assetId?: string): Promise<Signal | null> {
  const generated = await generateSignalBundle({ assetId });
  if (!generated) return null;
  const { signal, baseAnalysis } = generated;
  io.emit(WsServerEvents.SignalNew, signal);
  console.log(
    `[signal] emitted ${signal.ticker} ${signal.action} conf=${signal.confidence.toFixed(2)}${signal.degraded ? ' (degraded)' : ''} id=${signal.id}`,
  );

  // v1.3 Stage 2: hand the base analysis to the per-user Proposal Generator,
  // which writes Proposal rows for every matching mandate and emits per-user.
  if (signal.action === 'BUY') {
    const prisma = getPrisma();
    if (prisma) {
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
