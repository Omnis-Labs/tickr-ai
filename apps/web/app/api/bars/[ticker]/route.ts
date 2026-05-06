import { NextResponse } from 'next/server';
import {
  BARE_TICKERS,
  PYTH_BENCHMARKS_BASE,
  type BareTicker,
} from '@hunch-it/shared';

interface TvResponse {
  s: 'ok' | 'no_data' | 'error';
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  errmsg?: string;
}

const BENCHMARKS = process.env.PYTH_BENCHMARKS_URL ?? PYTH_BENCHMARKS_BASE;

/**
 * Thin proxy over Pyth Benchmarks tradingview shim. Used by the SignalModal
 * mini chart so we don't have to ship browser-side `Equity.US.<TICKER>/USD`
 * URL construction logic.
 *
 *   GET /api/bars/AAPL?resolution=5&hours=24
 */
export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params;
  const bare = (ticker.endsWith('x') ? ticker.slice(0, -1) : ticker).toUpperCase() as BareTicker;
  if (!BARE_TICKERS.includes(bare)) {
    return NextResponse.json({ error: `unknown ticker ${ticker}` }, { status: 400 });
  }
  const url = new URL(req.url);
  const resolution = url.searchParams.get('resolution') ?? '5';
  const hours = Math.min(Number(url.searchParams.get('hours') ?? '24'), 168);
  const to = Math.floor(Date.now() / 1000);
  const from = to - hours * 3600;
  const benchUrl =
    `${BENCHMARKS}/v1/shims/tradingview/history` +
    `?symbol=${encodeURIComponent(`Equity.US.${bare}/USD`)}` +
    `&resolution=${encodeURIComponent(resolution)}&from=${from}&to=${to}`;

  const r = await fetch(benchUrl, { next: { revalidate: 60 } });
  if (!r.ok) {
    return NextResponse.json({ error: `benchmarks ${r.status}` }, { status: 502 });
  }
  const json = (await r.json()) as TvResponse;
  if (json.s !== 'ok' || !json.t || !json.c) {
    return NextResponse.json({ bars: [] });
  }
  const bars = json.t.map((time, i) => ({
    time,
    open: json.o?.[i] ?? 0,
    high: json.h?.[i] ?? 0,
    low: json.l?.[i] ?? 0,
    close: json.c?.[i] ?? 0,
  }));
  return NextResponse.json({ bars });
}
