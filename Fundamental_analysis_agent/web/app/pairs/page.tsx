"use client";

import { useState } from "react";
import { createPairs, pollPairs, Task23Job, PairResult, PairSpec } from "@/lib/api";
import { EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  stretched: "text-amber-400 border-amber-700 bg-amber-950/30",
  diverging: "text-zinc-300 border-zinc-700 bg-zinc-900",
  tight: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
};
const RLABEL: Record<string, string> = {
  spread_regime: "Spread", return_correlation: "Return correlation", current_z_score: "Current z-score",
  hedge_ratio_beta: "Hedge ratio β", half_life_days: "Half-life (days)",
};

export default function PairsPage() {
  const [tickers, setTickers] = useState("");
  const [job, setJob] = useState<Task23Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = tickers.trim(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createPairs(t); setJob(j); pollPairs(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 23</h1>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Pairs Trading (stat-arb) → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">Enter <strong>two correlated tickers</strong>
        {" "}(e.g. KO, PEP). We build the spread (logA − β·logB, β from a trailing OLS), and when its rolling <strong>z-score</strong>
        {" "}stretches, bet on mean-reversion: long the cheap leg, short the rich one, <strong>dollar-neutral</strong>. The suite's
        one long-short strategy. β and z-stats use only trailing data → lookahead-free. Judge it on Sharpe/drawdown, not raw
        return — a market-neutral book isn't comparable to long-only buy-and-hold.</p></section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="Two tickers, e.g. KO, PEP"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code>{busy && " · estimating the spread, choosing thresholds, backtesting…"}</p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker_a} <span className="text-zinc-500 font-normal">vs</span> {r.ticker_b}</h2>
            <span className="text-xs text-zinc-500">{r.common_window_start} → {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.spec.stance] || ""}`}>{r.spec.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">enter |z| ≥ {r.spec.z_entry}</span> · exit |z| ≤ {r.spec.z_exit} · stop |z| ≥ {r.spec.stop_z} · {r.spec.formation_window}d window · max hold {r.spec.max_holding_days}d</div>
              <p className="text-sm text-zinc-300 leading-relaxed">{r.spec.thesis}</p>{r.spec.rationale && <p className="text-xs text-zinc-500">{r.spec.rationale}</p>}</div>
            <Backtest m={r.metrics} />
          </div>
          <Readings readings={r.pair_readings} labels={RLABEL} regimeKey="spread_regime" colors={REGIME} />
          <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve (market-neutral)</h3>
            <p className="text-xs"><span className="text-emerald-400">━ neutral strategy</span>{"   "}<span className="text-zinc-500">━ 50/50 basket</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
            <EquityChart curve={r.equity_curve} /></div>
          {r.trades.length > 0 && (
            <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto"><h3 className="text-sm font-semibold text-zinc-200 mb-2">Round-trips <span className="text-xs text-zinc-500 font-normal">(entry/exit shown as the spread z-score)</span></h3>
              <table className="w-full text-xs"><thead className="text-zinc-500 text-left"><tr><th className="py-1 pr-3">Entry</th><th className="pr-3 text-right">z in</th><th className="pr-3">Exit</th><th className="pr-3 text-right">z out</th><th className="pr-3">Reason</th><th className="pr-3 text-right">Return</th></tr></thead>
                <tbody className="text-zinc-300">{[...r.trades].reverse().slice(0, 20).map((t, i) => <tr key={i} className="border-t border-zinc-900"><td className="py-1 pr-3 whitespace-nowrap">{t.entry_date}</td><td className="pr-3 text-right tabular-nums">{t.entry_price}</td><td className="pr-3 whitespace-nowrap">{t.exit_date || "—"}</td><td className="pr-3 text-right tabular-nums">{t.exit_price ?? "—"}</td><td className="pr-3 text-zinc-500">{t.exit_reason || "open"}</td><td className={`pr-3 text-right ${(t.return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{t.return_pct != null ? `${t.return_pct >= 0 ? "+" : ""}${t.return_pct.toFixed(2)}%` : "—"}</td></tr>)}</tbody></table></div>
          )}
          <Caveats caveats={r.caveats} />
        </div>
      )}
    </div>
  );
}
