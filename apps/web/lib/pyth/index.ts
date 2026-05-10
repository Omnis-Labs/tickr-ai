// Server-side Pyth helper for the web app. Mirrors ws-server's getLatestPrices
// but kept self-contained so the web app doesn't depend on ws-server modules.

import {
  PYTH_HERMES_DEFAULT_URL,
  requireAsset,
  type PriceSnapshot,
} from '@hunch-it/shared';

interface ParsedPrice {
  id: string;
  price?: {
    price: string | number;
    conf?: string | number;
    expo: number;
    publish_time: number;
  };
}

const HERMES = process.env.PYTH_HERMES_URL ?? PYTH_HERMES_DEFAULT_URL;

function decode(price: string | number, expo: number): number {
  const raw = typeof price === 'string' ? Number(price) : price;
  return raw * 10 ** expo;
}

/**
 * Fetches the latest spot price for each tradable asset id via Hermes REST.
 * Returns prices keyed by asset id (e.g. "AAPLx", "wBTC").
 * Throws if any feed id is empty (constants not yet populated).
 */
export async function getCurrentPrices(
  assetIds: readonly string[],
): Promise<Map<string, number>> {
  const snapshots = await getCurrentPriceSnapshots(assetIds);
  return new Map(Array.from(snapshots, ([assetId, snap]) => [assetId, snap.price]));
}

export async function getCurrentPriceSnapshots(
  assetIds: readonly string[],
): Promise<Map<string, PriceSnapshot>> {
  const ids: string[] = [];
  const idToAsset = new Map<string, string>();
  for (const assetId of assetIds) {
    const asset = requireAsset(assetId);
    if (!asset.pythFeedId) continue;
    ids.push(asset.pythFeedId);
    idToAsset.set(
      asset.pythFeedId.startsWith('0x') ? asset.pythFeedId : `0x${asset.pythFeedId}`,
      assetId,
    );
  }
  if (ids.length === 0) return new Map();

  const params = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  const url = `${HERMES}/v2/updates/price/latest?${params}`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Hermes failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { parsed?: ParsedPrice[] };

  const out = new Map<string, PriceSnapshot>();
  for (const p of json.parsed ?? []) {
    const id = p.id.startsWith('0x') ? p.id : `0x${p.id}`;
    const assetId = idToAsset.get(id);
    if (!assetId || !p.price) continue;
    out.set(assetId, {
      ticker: assetId,
      price: decode(p.price.price, p.price.expo),
      confidence: decode(p.price.conf ?? 0, p.price.expo),
      publishTime: p.price.publish_time,
    });
  }
  return out;
}
