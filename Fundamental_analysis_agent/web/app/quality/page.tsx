"use client";

import { useState } from "react";
import { createQuality, pollQuality, Task17Job, QualityResult, QualitySpec } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  high_quality: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  mixed: "text-zinc-300 border-zinc-700 bg-zinc-900",
  weak: "text-amber-400 border-amber-700 bg-amber-950/30",
  no_data: "text-zinc-400 border-zinc-700 bg-zinc-900",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", f_score: "Piotroski F-Score", low_accruals: "Low accruals (earnings quality)",
  low_asset_growth: "Low asset growth", composite_quality: "Composite quality",
  deteriorating: "Exit when quality fails", time_exit: "Time exit", hold: "Hold to end",
};
const RLABEL: Record<string, string> = {
  quality_regime: "Regime", f_score: "F-Score (0–9)", roa_pct: "ROA", accruals_pct: "Accruals/assets",
  asset_growth_pct: "Asset growth YoY", latest_fy_end: "Latest FY end", latest_filed: "Latest filed",
};

export default function QualityPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task17Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createQuality(t); setJob(j); pollQuality(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 17</h1>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Fundamental Quality (XBRL) → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">Enter a ticker. From SEC XBRL we compute three
        classic <strong>quality factors</strong> — Piotroski <strong>F-Score</strong> (0–9), <strong>Sloan accruals</strong>
        (earnings quality), and the <strong>asset-growth</strong> anomaly — point-in-time, filing-date keyed. An LLM picks
        which factor (or a composite) to gate on. Slow, annual signal; lookahead-free.</p></section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker}<span className="text-sm text-zinc-500 font-normal"> · {r.company_name}</span></h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
            <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Thesis s={r.strategy} /><Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.quality_readings} labels={RLABEL} regimeKey="quality_regime" colors={REGIME} />
          <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
            <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
            <EquityChart curve={r.backtest.equity_curve} /></div>
          <Caveats caveats={r.caveats} />
        </div>
      )}
    </div>
  );
}

function Thesis({ s }: { s: QualitySpec }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
      <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[s.stance] || ""}`}>{s.stance}</span></div>
      <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[s.entry_signal] || s.entry_signal}</span>{" → "}<span className="text-zinc-200">{SIG[s.exit_signal] || s.exit_signal}</span>{(s.entry_signal === "f_score" || s.entry_signal === "composite_quality") && <span> · F ≥ {s.f_threshold}</span>}{s.exit_signal === "time_exit" && <span> · hold {s.holding_days}d</span>}</div>
      <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>{s.rationale && <p className="text-xs text-zinc-500">{s.rationale}</p>}</div>
  );
}
