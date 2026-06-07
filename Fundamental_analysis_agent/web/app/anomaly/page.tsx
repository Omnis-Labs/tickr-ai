"use client";

import { useState } from "react";
import { createAnomaly, pollAnomaly, Task19Job, AnomalyResult, AnomalySpec } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  near_high: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  mid_range: "text-zinc-300 border-zinc-700 bg-zinc-900",
  deep_below_high: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", near_52w_high: "52-week-high momentum",
  avoid_max_lottery: "Avoid lottery spikes (MAX)", tax_loss_reversal: "Tax-loss reversal (Jan effect)",
};
const RLABEL: Record<string, string> = {
  anomaly_regime: "Regime", pct_below_52w_high: "Below 52w high", recent_max_daily_pct: "Recent max daily move",
  trailing_11m_return_pct: "Trailing 11m return", current_month: "Month",
};

export default function AnomalyPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task19Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createAnomaly(t); setJob(j); pollAnomaly(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 19</h1>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Price Anomalies → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">Enter a ticker. Three documented price anomalies,
        prices only: <strong>52-week-high momentum</strong> (proximity to the high predicts continuation),{" "}
        <strong>MAX / lottery avoidance</strong> (chase-the-spike underperforms), and <strong>tax-loss reversal</strong>
        (YTD losers rebound in Dec–Jan). The LLM picks one; trailing-window + calendar → lookahead-free.</p></section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. NVDA"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker}</h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
            <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span>{r.strategy.entry_signal === "near_52w_high" && <span> · within {r.strategy.high_threshold_pct}%</span>}{r.strategy.entry_signal === "avoid_max_lottery" && <span> · spike &gt; {r.strategy.max_daily_threshold_pct}%</span>}</div>
              <p className="text-sm text-zinc-300 leading-relaxed">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.anomaly_readings} labels={RLABEL} regimeKey="anomaly_regime" colors={REGIME} />
          <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
            <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
            <EquityChart curve={r.backtest.equity_curve} /></div>
          <Caveats caveats={r.caveats} />
        </div>
      )}
    </div>
  );
}
