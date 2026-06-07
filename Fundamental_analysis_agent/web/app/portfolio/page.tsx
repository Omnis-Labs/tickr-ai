"use client";

import { useState } from "react";
import {
  createPortfolio,
  pollPortfolio,
  Task10Job,
  PortfolioResult,
  PortfolioMetrics,
  PortfolioSpec,
  Holding,
} from "@/lib/api";
import { EquityChart } from "../strategy/Charts";

const STANCE_COLOR: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};

const METHOD_LABEL: Record<string, string> = {
  equal_weight: "Equal weight",
  inverse_vol: "Inverse volatility",
  risk_parity: "Risk parity (equal-risk-contribution)",
  signal_proportional: "Signal-proportional (by conviction)",
};

const READING_LABEL: Record<string, string> = {
  n_names: "Names", n_long_now: "Long now", breadth_pct_long_now: "Breadth (% long)",
  mean_ann_vol_pct: "Mean ann. vol", min_ann_vol_pct: "Min vol", max_ann_vol_pct: "Max vol",
  mean_pairwise_correlation: "Mean correlation",
};

function pct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }

export default function PortfolioPage() {
  const [tickers, setTickers] = useState("");
  const [job, setJob] = useState<Task10Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!tickers.trim()) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createPortfolio(tickers);
      setJob(j);
      pollPortfolio(j.job_id, (next) => {
        setJob(next);
        if (next.status !== "pending" && next.status !== "running") setBusy(false);
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  const result = job?.result ?? null;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-semibold">Task 10</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Portfolio / Risk Sizing — the capstone
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a watchlist (2–15 tickers). Each name gets its long/flat signal from the{" "}
          <strong>Task 4</strong> technical agent; an LLM then picks one <strong>sizing policy</strong>{" "}
          from a fixed menu (equal-weight / inverse-vol / risk-parity / signal-proportional, plus a
          single-name cap, gross cap, vol target and rebalance cadence) using as-of universe stats —
          NOT per-name weights, which are computed deterministically. A lookahead-free{" "}
          <strong>portfolio backtest</strong> then allocates across names vs an equal-weight basket
          and the S&amp;P 500.
        </p>
      </section>

      <form onSubmit={run} className="flex gap-2 max-w-2xl">
        <input
          value={tickers}
          onChange={(e) => setTickers(e.target.value)}
          placeholder="Watchlist, e.g. AAPL, MSFT, NVDA, XOM, JPM"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Running…" : "Build"}
        </button>
      </form>

      {err && <p className="text-red-400 text-sm">{err}</p>}

      {job && (
        <p className="text-xs text-zinc-500">
          job <code className="text-zinc-300">{job.job_id}</code> · status{" "}
          <code className={
            job.status === "succeeded" ? "text-emerald-400"
            : job.status === "failed" ? "text-red-400" : "text-zinc-300"
          }>{job.status}</code>
          {busy && " · authoring per-name signals, choosing sizing policy, backtesting the book…"}
        </p>
      )}

      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}

      {result && <ResultView r={result} />}
    </div>
  );
}

function ResultView({ r }: { r: PortfolioResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.tickers.join(" · ")}</h2>
        <span className="text-xs text-zinc-500">
          {r.common_window_start} → {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}
        </span>
      </div>

      <PolicyPanel s={r.spec} readings={r.universe_readings} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricsPanel m={r.metrics} />
        <HoldingsTable holdings={r.holdings} />
      </div>

      <div className="border border-zinc-800 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-300">Portfolio equity curve</h3>
          <p className="text-xs">
            <span className="text-emerald-400">━ portfolio</span>{"   "}
            <span className="text-zinc-500">━ equal-weight basket</span>{"   "}
            <span className="text-blue-400">┄ S&amp;P 500</span>
          </p>
        </div>
        <EquityChart curve={r.equity_curve} />
      </div>

      <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950/40">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Honesty &amp; limitations
        </h3>
        <ul className="text-xs text-zinc-500 space-y-1 list-disc pl-4">
          {r.caveats.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
    </div>
  );
}

function PolicyPanel({ s, readings }: { s: PortfolioSpec; readings: Record<string, number | string> }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3 bg-zinc-950/40">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-zinc-200">Sizing policy</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[s.stance] || ""}`}>{s.stance}</span>
      </div>
      <div className="text-xs text-zinc-400">
        <span className="text-zinc-100 font-medium">{METHOD_LABEL[s.method] || s.method}</span>
        {" · "}max weight {Math.round(s.max_weight * 100)}%
        {" · "}gross {Math.round(s.gross_cap * 100)}%
        {s.target_vol_pct > 0 && <span> · vol target {s.target_vol_pct}%</span>}
        {" · "}{s.rebalance} rebalance{" · "}{s.vol_lookback_days}d lookback
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-y-2 gap-x-2 border-t border-zinc-800 pt-3">
        {Object.keys(READING_LABEL).filter((k) => k in readings).map((k) => (
          <div key={k}>
            <div className="text-[11px] text-zinc-500">{READING_LABEL[k]}</div>
            <div className="text-sm font-medium text-zinc-200">{String(readings[k])}</div>
          </div>
        ))}
      </div>
      {s.thesis && <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>}
      {s.rationale && <p className="text-xs text-zinc-500"><span className="text-zinc-400">Risk controls:</span> {s.rationale}</p>}
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const color = good == null ? "text-zinc-200" : good ? "text-emerald-400" : "text-red-400";
  return (
    <div>
      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function MetricsPanel({ m }: { m: PortfolioMetrics }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">
        Portfolio backtest <span className="text-xs text-zinc-500 font-normal">({m.days} days, {m.transaction_cost_bps} bps/side)</span>
      </h3>
      <div className="grid grid-cols-3 gap-y-3 gap-x-2 mb-3">
        <Metric label="Portfolio" value={pct(m.total_return_pct)} good={m.total_return_pct >= 0} />
        <Metric label="Equal-wt basket" value={pct(m.benchmark_return_pct)} />
        <Metric label="Excess vs basket" value={pct(m.excess_return_pct)} good={m.excess_return_pct >= 0} />
        {m.market_return_pct != null && (
          <>
            <div />
            <Metric label="S&P 500" value={pct(m.market_return_pct)} />
            <Metric label="Alpha vs market" value={pct(m.excess_vs_market_pct as number)} good={(m.excess_vs_market_pct as number) >= 0} />
          </>
        )}
      </div>
      <div className="grid grid-cols-3 gap-y-4 gap-x-2 border-t border-zinc-800 pt-3">
        <Metric label="CAGR" value={pct(m.cagr_pct)} good={m.cagr_pct >= 0} />
        <Metric label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe >= 1} />
        <Metric label="Max drawdown" value={pct(m.max_drawdown_pct)} good={false} />
        <Metric label="Ann. vol" value={`${m.ann_vol_pct.toFixed(1)}%${m.target_vol_pct ? ` / tgt ${m.target_vol_pct}%` : ""}`} />
        <Metric label="Avg holdings" value={m.avg_n_holdings.toFixed(1)} />
        <Metric label="Avg gross" value={`${m.avg_gross_exposure_pct.toFixed(0)}%`} />
        <Metric label="Rebalances" value={String(m.n_rebalances)} />
        <Metric label="Turnover (ann.)" value={`${m.turnover_annual_pct.toFixed(0)}%`} />
      </div>
    </div>
  );
}

function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Holdings ({holdings.filter((h) => h.available).length})</h3>
      <table className="w-full text-xs">
        <thead className="text-zinc-500 text-left">
          <tr>
            <th className="py-1 pr-3">Ticker</th><th className="pr-3">Stance</th>
            <th className="pr-3">Long now</th><th className="pr-3 text-right">Vol</th>
            <th className="pr-3 text-right">Solo ret</th><th className="pr-3 text-right">Avg wt</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {holdings.map((h) => (
            <tr key={h.ticker} className={`border-t border-zinc-900 ${!h.available ? "opacity-50" : ""}`}>
              <td className="py-1 pr-3 font-medium">{h.ticker}</td>
              <td className="pr-3">
                {h.available ? (
                  <span className={STANCE_COLOR[h.stance || "neutral"]?.split(" ")[0]}>{h.stance}</span>
                ) : <span className="text-zinc-600">{h.note || "n/a"}</span>}
              </td>
              <td className="pr-3">{h.available ? (h.long_as_of ? "✓" : "—") : ""}</td>
              <td className="pr-3 text-right">{h.ann_vol_pct != null ? `${h.ann_vol_pct.toFixed(0)}%` : "—"}</td>
              <td className={`pr-3 text-right ${(h.standalone_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {h.standalone_return_pct != null ? pct(h.standalone_return_pct) : "—"}
              </td>
              <td className="pr-3 text-right text-zinc-200">{h.available ? `${h.avg_weight_pct.toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
