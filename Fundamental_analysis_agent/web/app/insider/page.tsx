"use client";

import { useState } from "react";
import {
  createInsider,
  pollInsider,
  Task6Job,
  InsiderResult,
  BacktestMetrics,
  InsiderSpec,
} from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";

const STANCE_COLOR: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};

const REGIME_COLOR: Record<string, string> = {
  cluster_buying: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  net_buying: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  net_selling: "text-amber-400 border-amber-700 bg-amber-950/30",
  mixed: "text-zinc-300 border-zinc-700 bg-zinc-900",
  no_activity: "text-zinc-400 border-zinc-700 bg-zinc-900",
};

const SIGNAL_LABEL: Record<string, string> = {
  buy_and_hold: "Buy & hold (baseline)",
  any_insider_buy: "After any insider buy",
  cluster_buy: "Cluster buying",
  net_value_buy: "Net $ buying threshold",
  hold: "Hold to end", time_exit: "Time exit", net_sell: "Exit on net selling",
};

const READING_LABEL: Record<string, string> = {
  insider_regime: "Insider regime", lookback_days: "Lookback (days)",
  buy_count: "Open-market buys", sell_count: "Open-market sales",
  distinct_buyers: "Distinct buyers", officer_buy_count: "Officer buys",
  buy_value_usd: "Buy value", sell_value_usd: "Sell value", net_value_usd: "Net value",
  largest_buy_usd: "Largest single buy", days_since_last_insider_buy: "Days since last buy",
};

function pct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }

function fmtReading(k: string, v: number | string): string {
  if (typeof v === "string") return v;
  if (k.endsWith("_usd")) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (k === "days_since_last_insider_buy") return v < 0 ? "never (in window)" : String(v);
  return String(v);
}

export default function InsiderPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task6Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createInsider(t);
      setJob(j);
      pollInsider(j.job_id, (next) => {
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
          <h1 className="text-2xl font-semibold">Task 6</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Insider (Form 4) → Strategy → Backtest
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We fetch its SEC <strong>Form 4</strong> filings, parse the
          open-market insider transactions, and build an insider-flow snapshot keyed off
          each filing&apos;s <strong>filing date</strong> (not the trade date) — so the
          backtest can only act once a filing was public. An LLM picks one strategy from a
          fixed insider-signal menu (grounded in those readings), then a lookahead-free
          backtest runs over the trailing ~3 years. Only open-market buys/sales are used;
          grants, option exercises and gifts are excluded, and selling is treated as a weak
          exit signal — not a short.
        </p>
      </section>

      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Running…" : "Generate"}
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
          {busy && " · fetching Form 4 filings, authoring strategy, backtesting…"}
        </p>
      )}

      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}

      {result && <ResultView r={result} />}
    </div>
  );
}

function ResultView({ r }: { r: InsiderResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.ticker}</h2>
        <span className="text-xs text-zinc-500">
          as-of {r.as_of_date} · {r.n_form4_filings} Form 4s · {r.n_transactions} txns
          {r.fetch_capped && " (capped)"} · cost ${r.cost_usd.toFixed(4)}
        </span>
      </div>

      <div className="border border-zinc-800 rounded-md p-3">
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">Price (split/dividend-adjusted)</h3>
        <p className="text-xs text-zinc-500 mb-2">
          <span className="text-emerald-400">▲</span> entry · <span className="text-red-400">▼</span> exit ·{" "}
          <span className="text-amber-400">┊</span> backtest window start
        </p>
        <CandlestickChart
          prices={r.prices}
          trades={r.backtest.trades}
          filingDate={r.backtest.start_date}
          markerLabel="window start"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ThesisPanel s={r.strategy} />
        <BacktestPanel m={r.backtest.metrics} />
      </div>

      <ReadingsPanel readings={r.insider_readings} />

      <div className="border border-zinc-800 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-300">Backtest equity curve</h3>
          <p className="text-xs">
            <span className="text-emerald-400">━ strategy</span>{"   "}
            <span className="text-zinc-500">━ buy &amp; hold</span>{"   "}
            <span className="text-blue-400">┄ S&amp;P 500</span>
          </p>
        </div>
        <EquityChart curve={r.backtest.equity_curve} />
      </div>

      <TradesTable trades={r.backtest.trades} />

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

function ThesisPanel({ s }: { s: InsiderSpec }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[s.stance] || ""}`}>{s.stance}</span>
      </div>
      <div className="text-xs text-zinc-400">
        <span className="text-zinc-200">{SIGNAL_LABEL[s.entry_signal] || s.entry_signal}</span>
        {" → exit on "}
        <span className="text-zinc-200">{SIGNAL_LABEL[s.exit_signal] || s.exit_signal}</span>
        {s.entry_signal === "cluster_buy" && <span> · ≥{s.min_distinct_buyers} buyers</span>}
        {s.entry_signal === "net_value_buy" && <span> · ≥${s.min_net_value_usd.toLocaleString()}</span>}
        <span> · {s.lookback_days}d lookback</span>
        {s.exit_signal === "time_exit" && <span> · hold {s.holding_days}d</span>}
        {s.stop_loss_pct > 0 && <span> · stop {s.stop_loss_pct}%</span>}
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>
      {(s.rationale_entry || s.rationale_exit) && (
        <div className="text-xs text-zinc-500 space-y-1">
          {s.rationale_entry && <p><span className="text-emerald-400">Entry:</span> {s.rationale_entry}</p>}
          {s.rationale_exit && <p><span className="text-red-400">Exit:</span> {s.rationale_exit}</p>}
        </div>
      )}
    </div>
  );
}

function ReadingsPanel({ readings }: { readings: Record<string, number | string> }) {
  const keys = Object.keys(readings);
  const regime = readings["insider_regime"];
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-zinc-200">Insider-flow readings (as-of)</h3>
        {typeof regime === "string" && (
          <span className={`text-[11px] px-2 py-0.5 rounded border ${REGIME_COLOR[regime] || ""}`}>
            {regime.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        Computed only from Form 4s filed on/before the decision date — the snapshot the LLM saw.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-y-3 gap-x-2">
        {keys.filter((k) => k !== "insider_regime").map((k) => {
          const v = readings[k];
          const isNet = k === "net_value_usd" && typeof v === "number";
          const color = isNet ? ((v as number) >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-200";
          return (
            <div key={k}>
              <div className="text-[11px] text-zinc-500">{READING_LABEL[k] || k}</div>
              <div className={`text-sm font-medium ${color}`}>{fmtReading(k, v)}</div>
            </div>
          );
        })}
      </div>
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

function BacktestPanel({ m }: { m: BacktestMetrics }) {
  const hasEntryBench = m.benchmark_from_entry_pct != null;
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">
        Backtest <span className="text-xs text-zinc-500 font-normal">({m.days} days, {m.transaction_cost_bps} bps/side)</span>
      </h3>
      <div className="grid grid-cols-3 gap-y-3 gap-x-2 mb-3">
        <Metric label="Strategy" value={pct(m.total_return_pct)} good={m.total_return_pct >= 0} />
        <Metric label="Hold · full window" value={pct(m.benchmark_return_pct)} />
        <Metric label="Excess · full" value={pct(m.excess_return_pct)} good={m.excess_return_pct >= 0} />
        {hasEntryBench && (
          <>
            <div />
            <Metric label="Hold · from entry" value={pct(m.benchmark_from_entry_pct as number)} />
            <Metric label="Excess · from entry" value={pct(m.excess_vs_entry_pct as number)} good={(m.excess_vs_entry_pct as number) >= 0} />
          </>
        )}
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
        <Metric label="Win rate" value={`${m.win_rate_pct.toFixed(0)}%`} />
        <Metric label="Trades" value={String(m.n_trades)} />
        <Metric label="Exposure" value={`${m.exposure_pct.toFixed(0)}%`} />
      </div>
    </div>
  );
}

function TradesTable({ trades }: { trades: InsiderResult["backtest"]["trades"] }) {
  if (trades.length === 0) {
    return (
      <div className="border border-zinc-800 rounded-md p-4 text-sm text-zinc-500">
        No trades triggered — the insider entry signal never fired in the backtest window.
      </div>
    );
  }
  return (
    <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Trades ({trades.length})</h3>
      <table className="w-full text-xs">
        <thead className="text-zinc-500 text-left">
          <tr>
            <th className="py-1 pr-3">Entry</th><th className="pr-3">@</th>
            <th className="pr-3">Exit</th><th className="pr-3">@</th>
            <th className="pr-3">Reason</th><th className="pr-3 text-right">Return</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {trades.map((t, i) => (
            <tr key={i} className="border-t border-zinc-900">
              <td className="py-1 pr-3">{t.entry_date}</td>
              <td className="pr-3">${t.entry_price.toFixed(2)}</td>
              <td className="pr-3">{t.exit_date ?? "—"}</td>
              <td className="pr-3">{t.exit_price != null ? `$${t.exit_price.toFixed(2)}` : "—"}</td>
              <td className="pr-3 text-zinc-500">{t.exit_reason || "—"}</td>
              <td className={`pr-3 text-right ${(t.return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {t.return_pct != null ? pct(t.return_pct) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
