/**
 * Real Pyth Hermes integration. Replaces the Phase 1 sinusoidal stub.
 *
 * Hermes returns price + exponent; the human-readable price is `price * 10^expo`
 * where `expo` is negative (e.g. price=23012, expo=-2 → $230.12).
 */

import { HermesClient } from '@pythnetwork/hermes-client';
import {
  BARE_TICKERS,
  XSTOCKS,
  requirePythFeedId,
  type BareTicker,
  type PriceSnapshot,
} from '@hunch-it/shared';
import { env } from '../env.js';

let hermes: HermesClient | null = null;
function getHermes(): HermesClient {
  // HermesClient defaults to a 5s fetch timeout and explicitly skips its
  // built-in retry on AbortError, so a single slow upstream response fails
  // the whole cycle. Bumping to 10s catches the long tail of public-endpoint
  // latency spikes; our caller already absorbs per-ticker errors and the
  // next 60s tick retries naturally, so we don't layer on extra retry here.
  if (!hermes) hermes = new HermesClient(env.PYTH_HERMES_URL, { timeout: 10_000 });
  return hermes;
}

interface HermesParsedPriceUpdate {
  id: string;
  price?: { price: string | number; conf?: string | number; expo: number; publish_time: number };
  ema_price?: { price: string | number; conf?: string | number; expo: number; publish_time: number };
}

function decode(price: string | number, expo: number): number {
  const raw = typeof price === 'string' ? Number(price) : price;
  return raw * 10 ** expo;
}

/**
 * Fetches the latest snapshot for each given ticker. Throws if any feed ID
 * is unset (constants not yet populated). Caller can catch + skip individual
 * tickers; we'd rather crash early than emit signals on missing data.
 */
export async function getLatestPrices(
  tickers: readonly BareTicker[] = BARE_TICKERS,
): Promise<Map<BareTicker, PriceSnapshot>> {
  const feedIds = tickers.map((t) => ({ ticker: t, id: requirePythFeedId(t) }));
  const ids = feedIds.map((f) => f.id);

  const client = getHermes();
  const update = (await client.getLatestPriceUpdates(ids)) as {
    parsed?: HermesParsedPriceUpdate[];
  };

  const byId = new Map<string, HermesParsedPriceUpdate>();
  for (const p of update.parsed ?? []) {
    // Hermes echoes ids without the 0x prefix; normalise.
    const id = p.id.startsWith('0x') ? p.id : `0x${p.id}`;
    byId.set(id, p);
  }

  const out = new Map<BareTicker, PriceSnapshot>();
  for (const { ticker, id } of feedIds) {
    const parsed = byId.get(id);
    if (!parsed?.price) continue;
    const snap: PriceSnapshot = {
      ticker,
      price: decode(parsed.price.price, parsed.price.expo),
      confidence: decode(parsed.price.conf ?? 0, parsed.price.expo),
      publishTime: parsed.price.publish_time,
    };
    out.set(ticker, snap);
  }
  return out;
}

/** Convenience for single-ticker callers. */
export async function getLatestPrice(ticker: BareTicker): Promise<PriceSnapshot | null> {
  const m = await getLatestPrices([ticker]);
  return m.get(ticker) ?? null;
}

// ----------------------------------------------------------------------------
// US equity market hours (NYSE / Nasdaq).
// Trading 09:30 → 16:00 America/New_York, Mon–Fri. We ignore holidays here —
// hackathon scope. The benchmarks shim still serves data on holidays; the
// signal generator uses publishTime freshness as the real gate.
// ----------------------------------------------------------------------------

export function isUsMarketOpen(at: Date = new Date()): boolean {
  // Convert `at` to America/New_York wall-clock components.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export interface FreshnessVerdict {
  fresh: boolean;
  ageSeconds: number;
  marketOpen: boolean;
  reason?: string;
}

export function evaluateFreshness(
  snap: PriceSnapshot,
  opts: { maxAgeSecondsWhenClosed?: number; bypass?: boolean } = {},
): FreshnessVerdict {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - snap.publishTime);
  const marketOpen = isUsMarketOpen();
  const max = opts.maxAgeSecondsWhenClosed ?? 15 * 60;
  if (opts.bypass) {
    return { fresh: true, ageSeconds, marketOpen, reason: 'bypassed' };
  }
  if (marketOpen) {
    return { fresh: true, ageSeconds, marketOpen };
  }
  if (ageSeconds <= max) {
    return { fresh: true, ageSeconds, marketOpen };
  }
  return {
    fresh: false,
    ageSeconds,
    marketOpen,
    reason: `market closed and price is ${ageSeconds}s old (>${max}s)`,
  };
}

export { XSTOCKS };
