"use client";

import { PricePoint, EquityPoint, Trade } from "@/lib/api";

// Dependency-free SVG charts. Candlesticks are index-spaced (standard — calendar
// gaps are collapsed); the equity curve is date-spaced via the same index map.

const W = 920;
const PAD = { l: 48, r: 12, t: 12, b: 22 };

function niceTicks(min: number, max: number, n = 4): number[] {
  if (max <= min) return [min];
  const step = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + i * step);
}

export function CandlestickChart({
  prices, trades, filingDate, markerLabel = "10-K filed",
}: { prices: PricePoint[]; trades: Trade[]; filingDate: string; markerLabel?: string }) {
  const H = 340;
  if (prices.length < 2) return <p className="text-zinc-500 text-sm">No price data.</p>;
  const lows = prices.map((p) => p.low);
  const highs = prices.map((p) => p.high);
  const yMin = Math.min(...lows);
  const yMax = Math.max(...highs);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / (prices.length - 1)) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const cw = Math.max(1, (plotW / prices.length) * 0.6);

  const idxByDate = new Map(prices.map((p, i) => [p.date, i]));
  const filingIdx = idxByDate.has(filingDate)
    ? idxByDate.get(filingDate)!
    : prices.findIndex((p) => p.date >= filingDate);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price candlestick chart">
      {niceTicks(yMin, yMax).map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#27272a" strokeWidth={1} />
          <text x={4} y={y(t) + 3} fill="#71717a" fontSize={10}>${t.toFixed(0)}</text>
        </g>
      ))}
      {filingIdx >= 0 && (
        <g>
          <line x1={x(filingIdx)} x2={x(filingIdx)} y1={PAD.t} y2={H - PAD.b}
                stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />
          <text x={x(filingIdx) + 3} y={PAD.t + 9} fill="#f59e0b" fontSize={9}>{markerLabel}</text>
        </g>
      )}
      {prices.map((p, i) => {
        const up = p.close >= p.open;
        const color = up ? "#10b981" : "#ef4444";
        const bodyTop = y(Math.max(p.open, p.close));
        const bodyH = Math.max(1, Math.abs(y(p.open) - y(p.close)));
        return (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(p.high)} y2={y(p.low)} stroke={color} strokeWidth={0.7} />
            <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={color} />
          </g>
        );
      })}
      {trades.map((t, k) => {
        const ei = idxByDate.get(t.entry_date);
        const xi = ei != null ? x(ei) : null;
        return (
          <g key={`t${k}`}>
            {xi != null && (
              <polygon points={`${xi},${y(t.entry_price) + 12} ${xi - 5},${y(t.entry_price) + 22} ${xi + 5},${y(t.entry_price) + 22}`}
                       fill="#34d399" />
            )}
            {t.exit_date && t.exit_price != null && idxByDate.get(t.exit_date) != null && (
              <polygon points={`${x(idxByDate.get(t.exit_date)!)},${y(t.exit_price) - 12} ${x(idxByDate.get(t.exit_date)!) - 5},${y(t.exit_price) - 22} ${x(idxByDate.get(t.exit_date)!) + 5},${y(t.exit_price) - 22}`}
                       fill="#f87171" />
            )}
          </g>
        );
      })}
      <text x={PAD.l} y={H - 6} fill="#52525b" fontSize={9}>{prices[0].date}</text>
      <text x={W - PAD.r} y={H - 6} fill="#52525b" fontSize={9} textAnchor="end">{prices[prices.length - 1].date}</text>
    </svg>
  );
}

export function EquityChart({ curve }: { curve: EquityPoint[] }) {
  const H = 240;
  if (curve.length < 2) return <p className="text-zinc-500 text-sm">No equity data.</p>;
  const hasMarket = curve.some((p) => p.market != null);
  const vals = curve.flatMap((p) => [p.strategy, p.benchmark, ...(p.market != null ? [p.market] : [])]);
  const yMin = Math.min(...vals);
  const yMax = Math.max(...vals);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / (curve.length - 1)) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const line = (key: "strategy" | "benchmark") =>
    curve.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const marketLine = curve
    .map((p, i) => (p.market != null ? `${x(i).toFixed(1)},${y(p.market).toFixed(1)}` : null))
    .filter(Boolean)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Backtest equity curve">
      {niceTicks(yMin, yMax).map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#27272a" strokeWidth={1} />
          <text x={4} y={y(t) + 3} fill="#71717a" fontSize={10}>{(t * 100 - 100).toFixed(0)}%</text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(1)} y2={y(1)} stroke="#3f3f46" strokeWidth={1} strokeDasharray="2 2" />
      {hasMarket && <polyline points={marketLine} fill="none" stroke="#60a5fa" strokeWidth={1.4} strokeDasharray="4 2" />}
      <polyline points={line("benchmark")} fill="none" stroke="#71717a" strokeWidth={1.4} />
      <polyline points={line("strategy")} fill="none" stroke="#10b981" strokeWidth={1.8} />
    </svg>
  );
}
