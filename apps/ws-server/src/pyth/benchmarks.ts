/**
 * Pyth Benchmarks API — TradingView-shaped historical OHLC for tradable assets.
 *
 *   GET https://benchmarks.pyth.network/v1/shims/tradingview/history
 *     ?symbol=Crypto.AAPLX/USD&resolution=5&from={unix}&to={unix}
 *
 * Response shape:
 *   { s: "ok" | "no_data", t: number[], o: number[], h: number[], l: number[], c: number[], v?: number[] }
 */

import { requireAsset, type Bar } from '@hunch-it/shared';
import { env } from '../env.js';

export type BarResolution = '1' | '5' | '15' | '60';

interface TvResponse {
  s: 'ok' | 'no_data' | 'error';
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
  errmsg?: string;
}

function pythSymbol(assetId: string): string {
  const asset = requireAsset(assetId);
  if (!asset.pythSymbol) {
    throw new Error(`[benchmarks] ${assetId} has no configured Pyth symbol`);
  }
  return asset.pythSymbol;
}

export async function getBarsRange(
  assetId: string,
  resolution: BarResolution,
  fromUnix: number,
  toUnix: number,
): Promise<Bar[]> {
  if (toUnix <= fromUnix) return [];
  const url =
    `${env.PYTH_BENCHMARKS_URL}/v1/shims/tradingview/history` +
    `?symbol=${encodeURIComponent(pythSymbol(assetId))}` +
    `&resolution=${resolution}` +
    `&from=${fromUnix}&to=${toUnix}`;

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Pyth benchmarks ${assetId}/${resolution} failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as TvResponse;
  if (json.s === 'no_data' || !json.t) return [];
  if (json.s !== 'ok' || !json.o || !json.h || !json.l || !json.c) {
    throw new Error(`Pyth benchmarks ${assetId}/${resolution}: ${json.errmsg ?? json.s}`);
  }
  return json.t.map((time, i) => ({
    time,
    open: json.o![i] ?? 0,
    high: json.h![i] ?? 0,
    low: json.l![i] ?? 0,
    close: json.c![i] ?? 0,
  }));
}

export async function getHistoricalBars(
  assetId: string,
  resolution: BarResolution = '5',
  hoursBack = 24,
): Promise<Bar[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - hoursBack * 3600;
  return getBarsRange(assetId, resolution, from, to);
}
