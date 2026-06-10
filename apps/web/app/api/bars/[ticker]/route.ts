import { NextResponse } from 'next/server';
import {
  PYTH_BENCHMARK_CHART_INTRADAY_CLIENT_SETTINGS,
  PythBenchmarkRequestError,
  PYTH_BENCHMARKS_BASE,
  createPythBenchmarkBarsClient,
  getAssetById,
  type PythBenchmarkFetch,
  type PythBenchmarkIntradayResolution,
} from '@hunch-it/shared';

const BENCHMARKS = process.env.PYTH_BENCHMARKS_URL ?? PYTH_BENCHMARKS_BASE;
const benchmarks = createPythBenchmarkBarsClient({
  baseUrl: BENCHMARKS,
  fetchImpl: fetch as unknown as PythBenchmarkFetch,
  ...PYTH_BENCHMARK_CHART_INTRADAY_CLIENT_SETTINGS,
});
const RESOLUTIONS = new Set<PythBenchmarkIntradayResolution>(['1', '5', '15', '60']);

/**
 * Thin proxy over Pyth Benchmarks tradingview shim. Used by the SignalModal
 * mini chart so we don't have to ship browser-side Pyth symbol construction
 * URL construction logic.
 *
 *   GET /api/bars/AAPLx?resolution=5&hours=24
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> },
): Promise<NextResponse> {
  const { ticker } = await ctx.params;
  const asset = getAssetById(ticker);
  if (!asset) {
    return NextResponse.json({ error: `unknown ticker ${ticker}` }, { status: 400 });
  }
  if (!asset.pythSymbol) {
    return NextResponse.json({ error: `ticker ${ticker} has no Pyth symbol` }, { status: 400 });
  }
  const url = new URL(req.url);
  const requestedResolution = url.searchParams.get('resolution') ?? '5';
  const resolution: PythBenchmarkIntradayResolution = RESOLUTIONS.has(
    requestedResolution as PythBenchmarkIntradayResolution,
  )
    ? (requestedResolution as PythBenchmarkIntradayResolution)
    : '5';
  const requestedHours = Number(url.searchParams.get('hours') ?? '24');
  const hours =
    Number.isFinite(requestedHours) && requestedHours > 0 ? Math.min(requestedHours, 168) : 24;

  try {
    const bars = await benchmarks.getRecentBars({ assetId: ticker, resolution, hoursBack: hours });
    return NextResponse.json({ bars });
  } catch (err) {
    if (err instanceof PythBenchmarkRequestError) {
      return NextResponse.json({ error: `benchmarks ${err.status ?? 'error'}` }, { status: 502 });
    }
    throw err;
  }
}
