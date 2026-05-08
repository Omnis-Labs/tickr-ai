/**
 * Real Pyth Hermes integration. Replaces the Phase 1 sinusoidal stub.
 *
 * Hermes returns price + exponent; the human-readable price is `price * 10^expo`
 * where `expo` is negative (e.g. price=23012, expo=-2 → $230.12).
 */

import { HermesClient } from '@pythnetwork/hermes-client';
import {
  getSignalAssets,
  requireAsset,
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
 * Fetches the latest snapshot for each given asset id. Throws if any feed ID
 * is unset (constants not yet populated). Caller can catch + skip individual
 * tickers; we'd rather crash early than emit signals on missing data.
 */
export async function getLatestPrices(
  assetIds: readonly string[] = getSignalAssets().map((asset) => asset.assetId),
): Promise<Map<string, PriceSnapshot>> {
  const feedIds = assetIds.map((assetId) => {
    const asset = requireAsset(assetId);
    if (!asset.pythFeedId) {
      throw new Error(`[pyth] ${assetId} has no configured xStock/crypto feed id`);
    }
    return { assetId, id: asset.pythFeedId };
  });
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

  const out = new Map<string, PriceSnapshot>();
  for (const { assetId, id } of feedIds) {
    const parsed = byId.get(id);
    if (!parsed?.price) continue;
    const snap: PriceSnapshot = {
      ticker: assetId,
      price: decode(parsed.price.price, parsed.price.expo),
      confidence: decode(parsed.price.conf ?? 0, parsed.price.expo),
      publishTime: parsed.price.publish_time,
    };
    out.set(assetId, snap);
  }
  return out;
}

/** Convenience for single-ticker callers. */
export async function getLatestPrice(assetId: string): Promise<PriceSnapshot | null> {
  const m = await getLatestPrices([assetId]);
  return m.get(assetId) ?? null;
}

export interface FreshnessVerdict {
  fresh: boolean;
  ageSeconds: number;
  reason?: string;
}

export function evaluateFreshness(
  snap: PriceSnapshot,
  opts: { maxAgeSeconds?: number; bypass?: boolean } = {},
): FreshnessVerdict {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - snap.publishTime);
  const max = opts.maxAgeSeconds ?? 15 * 60;
  if (opts.bypass) {
    return { fresh: true, ageSeconds, reason: 'bypassed' };
  }
  if (ageSeconds <= max) {
    return { fresh: true, ageSeconds };
  }
  return {
    fresh: false,
    ageSeconds,
    reason: `price is ${ageSeconds}s old (>${max}s)`,
  };
}
