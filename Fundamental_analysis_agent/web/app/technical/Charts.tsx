"use client";

// Task 4 reuses Task 3's dependency-free SVG charts verbatim. The candlestick's
// vertical marker is relabeled "window start" by the caller (it passes the
// backtest window start instead of a 10-K filing date).
export { CandlestickChart, EquityChart } from "../strategy/Charts";
