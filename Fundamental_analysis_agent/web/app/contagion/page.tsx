"use client";

import { useState } from "react";
import { createContagion, pollContagion, Task24Job, ContagionResult, ContagionSpec } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  last_positive: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  last_neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  last_negative: "text-amber-400 border-amber-700 bg-amber-950/30",
  stale: "text-zinc-400 border-zinc-700 bg-zinc-900",
  no_data: "text-zinc-400 border-zinc-700 bg-zinc-900",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", follow_positive: "Follow positive read-across", avoid_after_negative: "Avoid after negative read-across",
};
const POL: Record<string, string> = { bullish: "text-emerald-400", neutral: "text-zinc-400", bearish: "text-red-400" };
const RLABEL: Record<string, string> = {
  contagion_regime: "Regime", n_events: "Bellwether reports", n_positive: "Positive", n_negative: "Negative",
  days_since_last_report: "Days since last", bellwether: "Bellwether",
};

export default function ContagionPage() {
  const [tickers, setTickers] = useState("");
  const [job, setJob] = useState<Task24Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = tickers.trim(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createContagion(t); setJob(j); pollContagion(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 24</h1>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Earnings Contagion → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">Enter <strong>bellwether, peer</strong> (first reports,
        second is traded). When the bellwether's earnings hit, the read-across moves the peer before the peer reports its own
        numbers. We classify the bellwether's 8-K earnings (reusing Task 8) and trade the peer in the short window after — keyed
        to the bellwether's <strong>filing date</strong>, so it's lookahead-free. Read-across is a short, decaying drift.</p></section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="bellwether, peer — e.g. AVGO, MRVL"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code>{busy && " · classifying bellwether earnings, backtesting the peer…"}</p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.bellwether} <span className="text-zinc-500 font-normal">→</span> {r.peer}<span className="text-sm text-zinc-500 font-normal"> · trading {r.peer}</span></h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · {r.n_events} reports · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">{r.peer} price</h3>
            <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span>{r.strategy.entry_signal !== "buy_and_hold" && <span> · drift {r.strategy.drift_days}d</span>}{r.strategy.stop_loss_pct > 0 && <span> · stop {r.strategy.stop_loss_pct}%</span>}</div>
              <p className="text-sm text-zinc-300 leading-relaxed">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.contagion_readings} labels={RLABEL} regimeKey="contagion_regime" colors={REGIME} />
          {r.events.length > 0 && (
            <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto"><h3 className="text-sm font-semibold text-zinc-200 mb-2">{r.bellwether} earnings (classified)</h3>
              <table className="w-full text-xs"><thead className="text-zinc-500 text-left"><tr><th className="py-1 pr-3">Filed</th><th className="pr-3">Sentiment</th><th className="pr-3">Beat/miss</th><th className="pr-3">Guidance</th></tr></thead>
                <tbody className="text-zinc-300">{[...r.events].reverse().map((e, i) => <tr key={i} className="border-t border-zinc-900"><td className="py-1 pr-3 whitespace-nowrap">{e.filing_date}</td><td className={`pr-3 ${POL[e.sentiment] || ""}`}>{e.sentiment}</td><td className="pr-3">{e.beat_miss}</td><td className="pr-3 text-zinc-500">{e.guidance}</td></tr>)}</tbody></table></div>
          )}
          <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
            <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ {r.peer} buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
            <EquityChart curve={r.backtest.equity_curve} /></div>
          <Caveats caveats={r.caveats} />
        </div>
      )}
    </div>
  );
}
