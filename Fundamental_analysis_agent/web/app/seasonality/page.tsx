"use client";

import { useState } from "react";
import { createSeasonal, pollSeasonal, Task12Job, SeasonalResult, SeasonalSpec, BacktestMetrics } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold (no seasonal edge)", best_months: "Long in best months",
  sell_in_may: "Sell in May (long Nov–Apr)", turn_of_month: "Turn-of-month",
};
const RLABEL: Record<string, string> = {
  years_of_history: "History (yrs)", best_months: "Best months", worst_months: "Worst months",
  nov_apr_ann_pct: "Nov–Apr (ann.)", may_oct_ann_pct: "May–Oct (ann.)",
  turn_of_month_ann_pct: "Turn-of-month (ann.)", rest_of_month_ann_pct: "Rest-of-month (ann.)",
};
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function SeasonalityPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task12Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createSeasonal(t); setJob(j);
      pollSeasonal(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); });
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 12</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Seasonality / Calendar Effects → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We compute historical <strong>calendar statistics</strong> (month-of-year returns,
          sell-in-May split, turn-of-month) and an LLM picks a calendar rule. The rule itself is
          lookahead-free (the calendar is known in advance) — but the <em>pattern is estimated in-sample</em>,
          the weakest form of edge, so a weak signal correctly defaults to buy-and-hold.
        </p>
      </section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. SPY"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && <Result r={r} />}
    </div>
  );
}

function Result({ r }: { r: SeasonalResult }) {
  const s = r.strategy;
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.ticker}</h2>
        <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span>
      </div>
      <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
        <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-zinc-800 rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[s.stance] || ""}`}>{s.stance}</span></div>
          <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[s.entry_signal] || s.entry_signal}</span>
            {s.entry_signal === "best_months" && s.months.length > 0 && <span> · {s.months.map((m) => MONTHS[m]).join(", ")}</span>}</div>
          <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>
          {s.rationale && <p className="text-xs text-zinc-500">{s.rationale}</p>}
        </div>
        <Backtest m={r.backtest.metrics} />
      </div>
      <Readings readings={r.seasonality_readings} />
      <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
        <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
        <EquityChart curve={r.backtest.equity_curve} /></div>
      <Caveats caveats={r.caveats} />
    </div>
  );
}

function Readings({ readings }: { readings: Record<string, number | string> }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">Calendar statistics (full history)</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-y-3 gap-x-2">
        {Object.keys(RLABEL).filter((k) => k in readings).map((k) => {
          const v = readings[k]; const isPct = typeof v === "number" && k.endsWith("_pct");
          const color = isPct ? ((v as number) >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-200";
          return <div key={k}><div className="text-[11px] text-zinc-500">{RLABEL[k]}</div><div className={`text-sm font-medium ${color}`}>{isPct ? pct(v as number) : String(v)}</div></div>;
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const color = good == null ? "text-zinc-200" : good ? "text-emerald-400" : "text-red-400";
  return <div><div className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</div><div className={`text-lg font-semibold ${color}`}>{value}</div></div>;
}

function Backtest({ m }: { m: BacktestMetrics }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">Backtest <span className="text-xs text-zinc-500 font-normal">({m.days} days, {m.transaction_cost_bps} bps/side)</span></h3>
      <div className="grid grid-cols-3 gap-y-3 gap-x-2 mb-3">
        <Metric label="Strategy" value={pct(m.total_return_pct)} good={m.total_return_pct >= 0} /><Metric label="Hold · full" value={pct(m.benchmark_return_pct)} /><Metric label="Excess" value={pct(m.excess_return_pct)} good={m.excess_return_pct >= 0} />
        {m.market_return_pct != null && (<><div /><Metric label="S&P 500" value={pct(m.market_return_pct)} /><Metric label="Alpha vs mkt" value={pct(m.excess_vs_market_pct as number)} good={(m.excess_vs_market_pct as number) >= 0} /></>)}
      </div>
      <div className="grid grid-cols-3 gap-y-4 gap-x-2 border-t border-zinc-800 pt-3">
        <Metric label="CAGR" value={pct(m.cagr_pct)} good={m.cagr_pct >= 0} /><Metric label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe >= 1} /><Metric label="Max DD" value={pct(m.max_drawdown_pct)} good={false} />
        <Metric label="Win rate" value={`${m.win_rate_pct.toFixed(0)}%`} /><Metric label="Trades" value={String(m.n_trades)} /><Metric label="Exposure" value={`${m.exposure_pct.toFixed(0)}%`} />
      </div>
    </div>
  );
}

function Caveats({ caveats }: { caveats: string[] }) {
  return <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950/40"><h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Honesty &amp; limitations</h3><ul className="text-xs text-zinc-500 space-y-1 list-disc pl-4">{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>;
}
