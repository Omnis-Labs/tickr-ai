import {
  createPythBenchmarkBarsClient,
  type Bar,
  type PythBenchmarkFetch,
  type PythBenchmarkIntradayResolution,
} from '@hunch-it/shared';
import { env } from '../env.js';

export type BarResolution = PythBenchmarkIntradayResolution;

const benchmarks = createPythBenchmarkBarsClient({
  baseUrl: env.PYTH_BENCHMARKS_URL,
  fetchImpl: fetch as unknown as PythBenchmarkFetch,
  requestSpacingMs: 250,
  cacheTtlMs: 60_000,
  staleTtlMs: 15 * 60_000,
});

export async function getBarsRange(
  assetId: string,
  resolution: BarResolution,
  fromUnix: number,
  toUnix: number,
): Promise<Bar[]> {
  return benchmarks.getBarsRange({
    assetId,
    resolution,
    fromUnix,
    toUnix,
  });
}

export async function getHistoricalBars(
  assetId: string,
  resolution: BarResolution = '5',
  hoursBack = 24,
): Promise<Bar[]> {
  return benchmarks.getRecentBars({ assetId, resolution, hoursBack });
}
