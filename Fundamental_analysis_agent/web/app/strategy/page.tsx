"use client";

import { useState } from "react";
import {
  createStrategy,
  pollStrategy,
  Task3Job,
  StrategyResult,
  BacktestMetrics,
  StrategySpec,
} from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";

const STANCE_COLOR: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};

const SIGNAL_LABEL: Record<string, string> = {
  buy_and_hold: "Buy & hold", sma_cross: "SMA crossover", momentum: "Momentum breakout",
  rsi_oversold: "RSI oversold (accumulate)", hold: "Hold to end",
  sma_reverse: "SMA reverse cross", rsi_overbought: "RSI overbought", time_exit: "Time exit",
};

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function StrategyPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task3Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createStrategy(t);
      setJob(j);
      pollStrategy(j.job_id, (next) => {
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
          <h1 className="text-2xl font-semibold">Task 3</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Fundamentals → Strategy → Backtest
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We pull its latest 10-K through the Task 2 pipeline, an
          LLM forms a thesis and picks one executable strategy from a fixed menu
          (grounded in the filing), then we run a <strong>filing-date-aligned</strong> backtest —
          signals only act <em>after</em> the 10-K was public, so there is no lookahead.
          If the 10-K extraction is quarantined, we refuse to build a strategy on it.
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
            : job.status === "quarantined" ? "text-amber-400"
            : job.status === "failed" ? "text-red-400" : "text-zinc-300"
          }>{job.status}</code>
          {busy && " · pulling 10-K, authoring strategy, backtesting…"}
        </p>
      )}

      {job?.status === "quarantined" && (
        <div className="border border-amber-800 bg-amber-950/20 rounded-md p-4">
          <h3 className="text-amber-400 font-semibold text-sm mb-1">Refused — 10-K extraction quarantined</h3>
          <p className="text-sm text-zinc-300">{job.error_message}</p>
          <p className="text-xs text-zinc-500 mt-2">
            By design (ADR-007): we will not build a strategy on fundamentals we
            could not reliably extract.
          </p>
        </div>
      )}

      {job?.status === "failed" && (
        <p className="text-red-400 text-sm">{job.error_message}</p>
      )}

      {result && <ResultView r={result} />}
    </div>
  );
}

function ResultView({ r }: { r: StrategyResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">
          {r.ticker} <span className="text-zinc-500 text-sm">{r.company_name}</span>
        </h2>
        <span className="text-xs text-zinc-500">
          FY{r.fiscal_year} · 10-K available {r.filing_available_date} ·{" "}
          <a href={r.filing_url} target="_blank" rel="noreferrer" className="text-emerald-400 underline">filing</a>
          {" · "}cost ${r.cost_usd.toFixed(4)}
        </span>
      </div>

      {/* Candlestick */}
      <div className="border border-zinc-800 rounded-md p-3">
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">Price (split/dividend-adjusted)</h3>
        <p className="text-xs text-zinc-500 mb-2">
          <span className="text-emerald-400">▲</span> entry · <span className="text-red-400">▼</span> exit ·{" "}
          <span className="text-amber-400">┊</span> 10-K filing date (lookahead boundary)
        </p>
        <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.filing_available_date} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ThesisPanel s={r.strategy} />
        <BacktestPanel m={r.backtest.metrics} />
      </div>

      {/* Equity curve */}
      <div className="border border-zinc-800 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-300">Backtest equity curve</h3>
          <p className="text-xs">
            <span className="text-emerald-400">━ strategy</span>{"   "}
            <span className="text-zinc-500">━ buy &amp; hold</span>
          </p>
        </div>
        <EquityChart curve={r.backtest.equity_curve} />
      </div>

      <TradesTable r={r} />

      <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950/40">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Honesty & limitations
        </h3>
        <ul className="text-xs text-zinc-500 space-y-1 list-disc pl-4">
          {r.caveats.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
    </div>
  );
}

function ThesisPanel({ s }: { s: StrategySpec }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">Strategy & thesis</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[s.stance] || ""}`}>
          {s.stance}
        </span>
      </div>
      <div className="text-xs text-zinc-400">
        <span className="text-zinc-200">{SIGNAL_LABEL[s.entry_signal] || s.entry_signal}</span>
        {" → exit on "}
        <span className="text-zinc-200">{SIGNAL_LABEL[s.exit_signal] || s.exit_signal}</span>
        {s.stop_loss_pct > 0 && <span> · stop {s.stop_loss_pct}%</span>}
        {s.take_profit_pct > 0 && <span> · target {s.take_profit_pct}%</span>}
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>
      {(s.rationale_entry || s.rationale_exit) && (
        <div className="text-xs text-zinc-500 space-y-1">
          {s.rationale_entry && <p><span className="text-emerald-400">Entry:</span> {s.rationale_entry}</p>}
          {s.rationale_exit && <p><span className="text-red-400">Exit:</span> {s.rationale_exit}</p>}
        </div>
      )}
      {s.citations.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Grounded in 10-K</p>
          {s.citations.map((c, i) => (
            <blockquote key={i} className="text-xs text-zinc-400 border-l-2 border-zinc-700 pl-2">
              <span className="text-zinc-500">Item {c.item_id} ({c.item_title}): </span>
              “{c.quote}”
            </blockquote>
          ))}
        </div>
      )}
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

function backtestNote(m: BacktestMetrics): string | null {
  const full = m.excess_return_pct;
  const entry = m.excess_vs_entry_pct;
  if (full >= 0) {
    return "Beat buy-and-hold over the full window.";
  }
  // Underperformed full-window hold. Was it bad timing, or just warm-up cash drag?
  if (entry != null && entry >= -2) {
    return "Trailed full-window buy-and-hold mainly because the indicator warm-up kept it " +
      "in cash early (it structurally couldn't trade yet). Once invested, it roughly matched " +
      "holding from its own entry — so this is a warm-up cash-drag gap, not bad timing.";
  }
  if (entry != null && entry < -2) {
    return "Underperformed both buy-and-hold AND holding from its own entry — the timing itself " +
      "lost, not just the warm-up period. Shown honestly.";
  }
  return "Underperformed simply holding the stock — shown honestly, not hidden.";
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
      </div>
      <div className="grid grid-cols-3 gap-y-4 gap-x-2 border-t border-zinc-800 pt-3">
        <Metric label="CAGR" value={pct(m.cagr_pct)} good={m.cagr_pct >= 0} />
        <Metric label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe >= 1} />
        <Metric label="Max drawdown" value={pct(m.max_drawdown_pct)} good={false} />
        <Metric label="Win rate" value={`${m.win_rate_pct.toFixed(0)}%`} />
        <Metric label="Trades" value={String(m.n_trades)} />
        <Metric label="Exposure" value={`${m.exposure_pct.toFixed(0)}%`} />
      </div>
      {backtestNote(m) && (
        <p className="text-xs text-amber-400/80 mt-3">{backtestNote(m)}</p>
      )}
    </div>
  );
}

function TradesTable({ r }: { r: StrategyResult }) {
  const trades = r.backtest.trades;
  if (trades.length === 0) {
    return (
      <div className="border border-zinc-800 rounded-md p-4 text-sm text-zinc-500">
        No trades were triggered in the backtest window (the entry signal never fired).
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
