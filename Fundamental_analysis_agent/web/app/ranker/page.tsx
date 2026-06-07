"use client";

import { useState } from "react";
import {
  createRanking, pollRanking, Task21Job, RankResult, PortfolioMetrics, RankSpec, RankHolding,
} from "@/lib/api";
import { EquityChart } from "../strategy/Charts";

const STANCE_COLOR: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const FACTOR_LABEL: Record<string, string> = {
  momentum_12_1: "12-1 momentum", low_volatility: "Low volatility",
  near_52w_high: "Near 52-week high", short_term_reversal: "Short-term reversal",
};
const METHOD_LABEL: Record<string, string> = { equal_weight: "Equal weight", inverse_vol: "Inverse volatility" };
const READING_LABEL: Record<string, string> = {
  n_names: "Names", momentum_12_1_pct_min_mean_max: "12-1 mom (min/mean/max %)",
  ann_vol_pct_min_mean_max: "Ann. vol (min/mean/max %)", pct_of_52w_high_min_mean_max: "% of 52w high",
  reversal_1m_ret_pct_min_mean_max: "1m return (min/mean/max %)",
  momentum_dispersion_pct: "Momentum dispersion", vol_dispersion_pct: "Vol dispersion",
};

function pct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }

export default function RankerPage() {
  const [tickers, setTickers] = useState("");
  const [job, setJob] = useState<Task21Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!tickers.trim()) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createRanking(tickers);
      setJob(j);
      pollRanking(j.job_id, (next) => { setJob(next); if (next.status !== "pending" && next.status !== "running") setBusy(false); });
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }

  const result = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-semibold">Task 21</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Cross-sectional Factor Ranker</span>
        </div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a watchlist (3–20 tickers). The LLM picks ONE long-only <strong>cross-sectional factor</strong> —
          12-1 momentum, low volatility, proximity to the 52-week high, or short-term reversal — from as-of
          universe stats. At each rebalance the whole universe is ranked by that factor using only{" "}
          <strong>trailing data</strong>, and the top-N is held (equal- or inverse-vol weighted). The LLM never
          picks individual stocks; the ranking selects them deterministically and lookahead-free. Backtested vs an
          equal-weight, always-invested basket of ALL the names and the S&amp;P 500.
        </p>
      </section>

      <form onSubmit={run} className="flex gap-2 max-w-2xl">
        <input value={tickers} onChange={(e) => setTickers(e.target.value)}
          placeholder="Watchlist, e.g. AAPL, MSFT, NVDA, AMZN, GOOGL, META, JPM, XOM"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy}
          className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? "Running…" : "Rank"}
        </button>
      </form>

      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && (
        <p className="text-xs text-zinc-500">
          job <code className="text-zinc-300">{job.job_id}</code> · status{" "}
          <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code>
          {busy && " · fetching the universe, choosing a factor, ranking + backtesting…"}
        </p>
      )}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {result && <ResultView r={result} />}
    </div>
  );
}

function ResultView({ r }: { r: RankResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.tickers.join(" · ")}</h2>
        <span className="text-xs text-zinc-500">{r.common_window_start} → {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span>
      </div>
      <PolicyPanel s={r.spec} readings={r.universe_readings} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricsPanel m={r.metrics} />
        <HoldingsTable holdings={r.holdings} topN={r.spec.top_n} />
      </div>
      <div className="border border-zinc-800 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-300">Factor-portfolio equity curve</h3>
          <p className="text-xs"><span className="text-emerald-400">━ top-{r.spec.top_n}</span>{"   "}
            <span className="text-zinc-500">━ equal-weight basket</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p>
        </div>
        <EquityChart curve={r.equity_curve} />
      </div>
      <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950/40">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Honesty &amp; limitations</h3>
        <ul className="text-xs text-zinc-500 space-y-1 list-disc pl-4">{r.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </div>
    </div>
  );
}

function PolicyPanel({ s, readings }: { s: RankSpec; readings: Record<string, number | string> }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3 bg-zinc-950/40">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-zinc-200">Ranking policy</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[s.stance] || ""}`}>{s.stance}</span>
      </div>
      <div className="text-xs text-zinc-400">
        <span className="text-zinc-100 font-medium">{FACTOR_LABEL[s.factor] || s.factor}</span>
        {" · "}hold top {s.top_n}{" · "}{METHOD_LABEL[s.weight_method] || s.weight_method}
        {" · "}max weight {Math.round(s.max_weight * 100)}%{" · "}{s.rebalance} rebalance{" · "}{s.lookback_days}d lookback
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-y-2 gap-x-3 border-t border-zinc-800 pt-3">
        {Object.keys(READING_LABEL).filter((k) => k in readings).map((k) => (
          <div key={k}>
            <div className="text-[11px] text-zinc-500">{READING_LABEL[k]}</div>
            <div className="text-sm font-medium text-zinc-200">{String(readings[k])}</div>
          </div>
        ))}
      </div>
      {s.thesis && <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>}
      {s.rationale && <p className="text-xs text-zinc-500"><span className="text-zinc-400">Why this factor:</span> {s.rationale}</p>}
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const color = good == null ? "text-zinc-200" : good ? "text-emerald-400" : "text-red-400";
  return (
    <div><div className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div></div>
  );
}

function MetricsPanel({ m }: { m: PortfolioMetrics }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">
        Factor backtest <span className="text-xs text-zinc-500 font-normal">({m.days} days, {m.transaction_cost_bps} bps/side)</span>
      </h3>
      <div className="grid grid-cols-3 gap-y-3 gap-x-2 mb-3">
        <Metric label="Top-N" value={pct(m.total_return_pct)} good={m.total_return_pct >= 0} />
        <Metric label="Equal-wt basket" value={pct(m.benchmark_return_pct)} />
        <Metric label="Excess vs basket" value={pct(m.excess_return_pct)} good={m.excess_return_pct >= 0} />
        {m.market_return_pct != null && (
          <><div /><Metric label="S&P 500" value={pct(m.market_return_pct)} />
            <Metric label="Alpha vs market" value={pct(m.excess_vs_market_pct as number)} good={(m.excess_vs_market_pct as number) >= 0} /></>
        )}
      </div>
      <div className="grid grid-cols-3 gap-y-4 gap-x-2 border-t border-zinc-800 pt-3">
        <Metric label="CAGR" value={pct(m.cagr_pct)} good={m.cagr_pct >= 0} />
        <Metric label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe >= 1} />
        <Metric label="Max drawdown" value={pct(m.max_drawdown_pct)} good={false} />
        <Metric label="Ann. vol" value={`${m.ann_vol_pct.toFixed(1)}%`} />
        <Metric label="Avg holdings" value={m.avg_n_holdings.toFixed(1)} />
        <Metric label="Avg gross" value={`${m.avg_gross_exposure_pct.toFixed(0)}%`} />
        <Metric label="Rebalances" value={String(m.n_rebalances)} />
        <Metric label="Turnover (ann.)" value={`${m.turnover_annual_pct.toFixed(0)}%`} />
      </div>
    </div>
  );
}

function HoldingsTable({ holdings, topN }: { holdings: RankHolding[]; topN: number }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Universe ranked now <span className="text-xs text-zinc-500 font-normal">(top {topN} held)</span></h3>
      <table className="w-full text-xs">
        <thead className="text-zinc-500 text-left">
          <tr><th className="py-1 pr-3">#</th><th className="pr-3">Ticker</th><th className="pr-3 text-right">Factor</th>
            <th className="pr-3">Held</th><th className="pr-3 text-right">Solo ret</th><th className="pr-3 text-right">Avg wt</th></tr>
        </thead>
        <tbody className="text-zinc-300">
          {holdings.map((h) => (
            <tr key={h.ticker} className={`border-t border-zinc-900 ${!h.available ? "opacity-50" : ""} ${h.selected_now ? "bg-emerald-950/20" : ""}`}>
              <td className="py-1 pr-3 text-zinc-500">{h.rank ?? "—"}</td>
              <td className="pr-3 font-medium">{h.ticker}</td>
              <td className="pr-3 text-right tabular-nums">{h.factor_value != null ? h.factor_value.toFixed(3) : (h.available ? "—" : h.note || "n/a")}</td>
              <td className="pr-3">{h.available ? (h.selected_now ? <span className="text-emerald-400">✓</span> : "—") : ""}</td>
              <td className={`pr-3 text-right ${(h.standalone_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {h.standalone_return_pct != null ? pct(h.standalone_return_pct) : "—"}</td>
              <td className="pr-3 text-right text-zinc-200">{h.available ? `${h.avg_weight_pct.toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
