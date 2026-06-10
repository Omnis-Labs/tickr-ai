import { getSignalAssets, requireAsset } from './assets.js';
import type { PriceSnapshot } from './types.js';

export const PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST = 100;

export function chunkPythLatestPriceFeedIds<T>(ids: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < ids.length; index += PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST) {
    chunks.push(ids.slice(index, index + PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST));
  }
  return chunks;
}

export type PythLatestPriceCacheMode =
  | 'default'
  | 'force-cache'
  | 'no-cache'
  | 'no-store'
  | 'only-if-cached'
  | 'reload';

export interface PythLatestPriceFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type PythLatestPriceFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
    cache?: PythLatestPriceCacheMode;
  },
) => Promise<PythLatestPriceFetchResponse>;

export interface PythLatestPriceClient {
  getLatestPriceSnapshots(assetIds?: readonly string[]): Promise<Map<string, PriceSnapshot>>;
  getLatestPrices(assetIds?: readonly string[]): Promise<Map<string, number>>;
  getLatestPriceSnapshot(assetId: string): Promise<PriceSnapshot | null>;
}

export interface CreatePythLatestPriceClientInput {
  baseUrl: string;
  fetchImpl: PythLatestPriceFetch;
  cacheMode?: PythLatestPriceCacheMode;
}

export class PythLatestPriceRequestError extends Error {
  readonly status?: number;

  constructor(input: { message: string; status?: number }) {
    super(input.message);
    this.name = 'PythLatestPriceRequestError';
    this.status = input.status;
  }
}

interface ParsedPrice {
  id: string;
  price?: {
    price: string | number;
    conf?: string | number;
    expo: number;
    publish_time: number;
  };
}

function normalizeFeedId(id: string): string {
  return id.startsWith('0x') ? id : `0x${id}`;
}

function decode(price: string | number, expo: number): number {
  const raw = typeof price === 'string' ? Number(price) : price;
  return raw * 10 ** expo;
}

function feedIdsForAssetIds(assetIds: readonly string[]): {
  ids: string[];
  idToAsset: Map<string, string>;
} {
  const ids: string[] = [];
  const idToAsset = new Map<string, string>();
  for (const assetId of assetIds) {
    const asset = requireAsset(assetId);
    if (!asset.pythFeedId) {
      throw new Error(`[pyth-latest] ${assetId} has no configured Pyth feed id`);
    }
    ids.push(asset.pythFeedId);
    idToAsset.set(normalizeFeedId(asset.pythFeedId), assetId);
  }
  return { ids, idToAsset };
}

function buildLatestPriceUrl(baseUrl: string, ids: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append('ids[]', id);
  return `${baseUrl.replace(/\/+$/, '')}/v2/updates/price/latest?${params.toString()}`;
}

export function createPythLatestPriceClient(
  input: CreatePythLatestPriceClientInput,
): PythLatestPriceClient {
  async function getLatestPriceSnapshots(
    assetIds: readonly string[] = getSignalAssets().map((asset) => asset.assetId),
  ): Promise<Map<string, PriceSnapshot>> {
    const { ids, idToAsset } = feedIdsForAssetIds(assetIds);
    if (ids.length === 0) return new Map();

    const out = new Map<string, PriceSnapshot>();
    for (const chunk of chunkPythLatestPriceFeedIds(ids)) {
      const url = buildLatestPriceUrl(input.baseUrl, chunk);
      const res = await input.fetchImpl(url, {
        headers: { accept: 'application/json' },
        cache: input.cacheMode,
      });
      if (!res.ok) {
        throw new PythLatestPriceRequestError({
          status: res.status,
          message: `Pyth latest prices failed: ${res.status} ${res.statusText}`,
        });
      }

      const json = (await res.json()) as { parsed?: ParsedPrice[] };
      for (const parsed of json.parsed ?? []) {
        const assetId = idToAsset.get(normalizeFeedId(parsed.id));
        if (!assetId || !parsed.price) continue;
        out.set(assetId, {
          ticker: assetId,
          price: decode(parsed.price.price, parsed.price.expo),
          confidence: decode(parsed.price.conf ?? 0, parsed.price.expo),
          publishTime: parsed.price.publish_time,
        });
      }
    }
    return out;
  }

  return {
    getLatestPriceSnapshots,
    async getLatestPrices(assetIds) {
      const snapshots = await getLatestPriceSnapshots(assetIds);
      return new Map(Array.from(snapshots, ([assetId, snap]) => [assetId, snap.price]));
    },
    async getLatestPriceSnapshot(assetId) {
      const snapshots = await getLatestPriceSnapshots([assetId]);
      return snapshots.get(assetId) ?? null;
    },
  };
}
