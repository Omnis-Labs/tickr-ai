"use client";

import { useState } from "react";
import { createGap, pollGap, Task13Job, GapResult, GapSpec, BacktestMetrics } from "@/lib/api";
import { EquityChart } from "./Charts";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", overnight: "Overnight only (close→open)",
  intraday: "Intraday only (open→close)", overnight_after_up: "Overnight after up days",
};
const RLABEL: Record<string, string> = {
  n_days: "Days", overnight_ann_pct: "Overnight (ann.)", intraday_ann_pct: "Intraday (ann.)",
  overnight_share: "Overnight share", overnight_win_rate_pct: "Overnight win rate",
};
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function OvernightPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task13Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createGap(t); setJob(j);
      pollGap(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); });
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 13</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Overnight vs Intraday (Gap) → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We split each day&apos;s return into the <strong>overnight</strong> move
          (prior close → open) and the <strong>intraday</strong> move (open → close) — the documented
          anomaly is most US-equity return accrues overnight. An LLM picks a participation rule, and the
          backtest is <strong>honest about costs</strong>: overnight-only trades a round-trip every day,
          which usually erases the gross edge.
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

function Result({ r }: { r: GapResult }) {
  const s = r.strategy;
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.ticker}</h2>
        <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span>
      </div>
      <Readings readings={r.gap_readings} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-zinc-800 rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[s.stance] || ""}`}>{s.stance}</span></div>
          <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[s.entry_signal] || s.entry_signal}</span></div>
          <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>
          {s.rationale && <p className="text-xs text-zinc-500">{s.rationale}</p>}
        </div>
        <Backtest m={r.backtest.metrics} />
      </div>
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
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">Overnight vs intraday decomposition (full history)</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-3 gap-x-2">
        {Object.keys(RLABEL).filter((k) => k in readings).map((k) => {
          const v = readings[k]; const isPct = typeof v === "number" && k.endsWith("_pct") && k !== "overnight_win_rate_pct";
          const color = isPct ? ((v as number) >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-200";
          const shown = k === "overnight_win_rate_pct" && typeof v === "number" ? `${(v as number).toFixed(0)}%` : isPct ? pct(v as number) : String(v);
          return <div key={k}><div className="text-[11px] text-zinc-500">{RLABEL[k]}</div><div className={`text-sm font-medium ${color}`}>{shown}</div></div>;
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
        <Metric label="Win rate (days)" value={`${m.win_rate_pct.toFixed(0)}%`} /><Metric label="Days traded" value={String(m.n_trades)} /><Metric label="Exposure" value={`${m.exposure_pct.toFixed(0)}%`} />
      </div>
    </div>
  );
}

function Caveats({ caveats }: { caveats: string[] }) {
  return <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950/40"><h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Honesty &amp; limitations</h3><ul className="text-xs text-zinc-500 space-y-1 list-disc pl-4">{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>;
}
