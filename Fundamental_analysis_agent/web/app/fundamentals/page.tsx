"use client";

import { useState } from "react";
import {
  createFundTrend, pollFundTrend, Task11Job, FundTrendResult, FundTrendSpec, BacktestMetrics,
} from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  improving: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  mixed: "text-zinc-300 border-zinc-700 bg-zinc-900",
  deteriorating: "text-amber-400 border-amber-700 bg-amber-950/30",
  no_data: "text-zinc-400 border-zinc-700 bg-zinc-900",
};
const SIG: Record<string, string> = {
  revenue_growth: "Revenue growth", earnings_growth: "Earnings growth", margin_expansion: "Margin expansion",
  growth_and_margin: "Growth + margin", any_improving: "Any improvement",
  deteriorating: "Exit when deteriorating", time_exit: "Time exit", hold: "Hold to end",
};
const RLABEL: Record<string, string> = {
  fundamentals_regime: "Regime", n_quarters: "Quarters", latest_period: "Latest period",
  latest_filed: "Latest filed", revenue_yoy_pct: "Revenue YoY", earnings_yoy_pct: "Earnings YoY",
  gross_margin_pct: "Gross margin", margin_yoy_change_pp: "Margin Δ YoY",
};
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtB = (n: number | null) => n == null ? "—" : `$${(n / 1e9).toFixed(2)}B`;

export default function FundamentalsPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task11Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createFundTrend(t); setJob(j);
      pollFundTrend(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); });
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 11</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Fundamentals Trend (XBRL) → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We pull <strong>structured quarterly financials</strong> from SEC XBRL
          (revenue / gross profit / net income), build a lookahead-safe <strong>fundamental-momentum</strong>{" "}
          signal — YoY growth + margin trend, keyed off each filing&apos;s <strong>filed date</strong>, using
          the as-originally-reported value — and an LLM trades the tendency for improving fundamentals to be
          rewarded. (Task 3 reads the 10-K <em>text</em>; this reads the <em>numbers</em>.)
        </p>
      </section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code>{busy && " · fetching XBRL fundamentals, backtesting…"}</p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && <Result r={r} />}
    </div>
  );
}

function Result({ r }: { r: FundTrendResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.ticker}<span className="text-sm text-zinc-500 font-normal"> · {r.company_name}</span></h2>
        <span className="text-xs text-zinc-500">as-of {r.as_of_date} · {r.n_quarters} quarters · cost ${r.cost_usd.toFixed(4)}</span>
      </div>
      <div className="border border-zinc-800 rounded-md p-3">
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
        <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><Thesis s={r.strategy} /><Backtest m={r.backtest.metrics} /></div>
      <Readings readings={r.fundamentals_readings} />
      <Quarters quarters={r.quarters} />
      <div className="border border-zinc-800 rounded-md p-3">
        <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
          <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
        <EquityChart curve={r.backtest.equity_curve} />
      </div>
      <Caveats caveats={r.caveats} />
    </div>
  );
}

function Thesis({ s }: { s: FundTrendSpec }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[s.stance] || ""}`}>{s.stance}</span></div>
      <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[s.entry_signal] || s.entry_signal}</span>{" → "}<span className="text-zinc-200">{SIG[s.exit_signal] || s.exit_signal}</span>{s.exit_signal === "time_exit" && <span> · hold {s.holding_days}d</span>}</div>
      <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>
      {(s.rationale_entry || s.rationale_exit) && <div className="text-xs text-zinc-500 space-y-1">{s.rationale_entry && <p><span className="text-emerald-400">Entry:</span> {s.rationale_entry}</p>}{s.rationale_exit && <p><span className="text-red-400">Exit:</span> {s.rationale_exit}</p>}</div>}
    </div>
  );
}

function Readings({ readings }: { readings: Record<string, number | string> }) {
  const regime = readings["fundamentals_regime"];
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <div className="flex items-center gap-2 mb-3"><h3 className="text-sm font-semibold text-zinc-200">Fundamentals (as-of)</h3>
        {typeof regime === "string" && <span className={`text-[11px] px-2 py-0.5 rounded border ${REGIME[regime] || ""}`}>{regime.replace(/_/g, " ")}</span>}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-y-3 gap-x-2">
        {Object.keys(RLABEL).filter((k) => k in readings && k !== "fundamentals_regime").map((k) => {
          const v = readings[k]; const isPct = typeof v === "number" && (k.endsWith("_pct") || k.endsWith("_pp"));
          const color = isPct ? ((v as number) >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-200";
          return <div key={k}><div className="text-[11px] text-zinc-500">{RLABEL[k]}</div><div className={`text-sm font-medium ${color}`}>{isPct ? pct(v as number) : String(v)}</div></div>;
        })}
      </div>
    </div>
  );
}

function Quarters({ quarters }: { quarters: FundTrendResult["quarters"] }) {
  if (!quarters.length) return null;
  return (
    <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Recent quarters (XBRL)</h3>
      <table className="w-full text-xs"><thead className="text-zinc-500 text-left"><tr><th className="py-1 pr-3">Period</th><th className="pr-3">Filed</th><th className="pr-3 text-right">Revenue</th><th className="pr-3 text-right">Gross profit</th><th className="pr-3 text-right">Net income</th></tr></thead>
        <tbody className="text-zinc-300">{[...quarters].reverse().map((q, i) => (
          <tr key={i} className="border-t border-zinc-900"><td className="py-1 pr-3">FY{q.fy} {q.fp}</td><td className="pr-3 text-zinc-500">{q.filed}</td><td className="pr-3 text-right">{fmtB(q.revenue)}</td><td className="pr-3 text-right">{fmtB(q.gross_profit)}</td><td className="pr-3 text-right">{fmtB(q.net_income)}</td></tr>))}</tbody></table>
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
        <Metric label="Strategy" value={pct(m.total_return_pct)} good={m.total_return_pct >= 0} />
        <Metric label="Hold · full" value={pct(m.benchmark_return_pct)} />
        <Metric label="Excess" value={pct(m.excess_return_pct)} good={m.excess_return_pct >= 0} />
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
  return (
    <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950/40">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Honesty &amp; limitations</h3>
      <ul className="text-xs text-zinc-500 space-y-1 list-disc pl-4">{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
    </div>
  );
}
