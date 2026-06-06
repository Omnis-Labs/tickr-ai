"use client";

import { useState } from "react";
import {
  createAnalysis,
  pollAnalysis,
  Task4Job,
  TechnicalResult,
  BacktestMetrics,
  TechnicalSpec,
} from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";

const STANCE_COLOR: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};

const SIGNAL_LABEL: Record<string, string> = {
  buy_and_hold: "Buy & hold", sma_cross: "SMA crossover", macd_cross: "MACD cross",
  momentum: "Momentum breakout", rsi_oversold: "RSI oversold (accumulate)",
  bollinger_breakout: "Bollinger breakout", donchian_breakout: "Donchian breakout",
  hold: "Hold to end", sma_reverse: "SMA reverse cross", macd_reverse: "MACD reverse cross",
  rsi_overbought: "RSI overbought", bollinger_revert: "Bollinger mean-revert",
  donchian_stop: "Donchian stop", time_exit: "Time exit",
};

// Human labels for the indicator readings grid.
const READING_LABEL: Record<string, string> = {
  last_close: "Last close", trend_regime: "Trend regime", rsi_14: "RSI(14)",
  macd_line: "MACD line", macd_signal: "MACD signal", macd_hist: "MACD hist",
  sma_20: "SMA 20", sma_50: "SMA 50", sma_200: "SMA 200",
  price_vs_sma20_pct: "Price vs SMA20", price_vs_sma50_pct: "Price vs SMA50",
  price_vs_sma200_pct: "Price vs SMA200", bollinger_pctb: "Bollinger %b",
  bollinger_bandwidth_pct: "Bollinger bandwidth", donchian_high_20: "Donchian high(20)",
  donchian_low_20: "Donchian low(20)", donchian_pos_pct: "Donchian position",
  vol_ratio_20_50: "Vol ratio 20/50", range_pos_52w_pct: "52w range position",
  realized_vol_annualized_pct: "Realized vol (ann.)",
};

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function TechnicalPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task4Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createAnalysis(t);
      setJob(j);
      pollAnalysis(j.job_id, (next) => {
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
          <h1 className="text-2xl font-semibold">Task 4</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Technicals → Strategy → Backtest
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We compute a snapshot of technical indicators
          (RSI, MACD, moving averages, Bollinger, Donchian, volume) strictly
          <strong> as-of the most recent close</strong>, an LLM picks one executable
          strategy from a fixed technical menu (grounded in those readings), then we
          run a lookahead-free backtest over the trailing ~3 years. Signals act on the
          next bar&apos;s open — no future data leaks into the rule.
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
          {busy && " · computing indicators, authoring strategy, backtesting…"}
        </p>
      )}

      {job?.status === "failed" && (
        <p className="text-red-400 text-sm">{job.error_message}</p>
      )}

      {result && <ResultView r={result} />}
    </div>
  );
}

function ResultView({ r }: { r: TechnicalResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.ticker}</h2>
        <span className="text-xs text-zinc-500">
          as-of {r.as_of_date} · backtest from {r.backtest.start_date}
          {" · "}cost ${r.cost_usd.toFixed(4)}
        </span>
      </div>

      {/* Candlestick */}
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

      <ReadingsPanel readings={r.indicator_readings} />

      {/* Equity curve */}
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

      <TradesTable r={r} />

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

function ThesisPanel({ s }: { s: TechnicalSpec }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[s.stance] || ""}`}>
          {s.stance}
        </span>
      </div>
      <div className="text-xs text-zinc-400">
        <span className="text-zinc-200">{SIGNAL_LABEL[s.entry_signal] || s.entry_signal}</span>
        {" → exit on "}
        <span className="text-zinc-200">{SIGNAL_LABEL[s.exit_signal] || s.exit_signal}</span>
        {s.require_volume_confirm && <span> · vol-confirm {s.volume_confirm_ratio}×</span>}
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
    </div>
  );
}

function ReadingsPanel({ readings }: { readings: Record<string, number | string> }) {
  const keys = Object.keys(readings).filter((k) => k !== "as_of_date");
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-1">Indicator readings (as-of)</h3>
      <p className="text-xs text-zinc-500 mb-3">
        The exact deterministic snapshot the LLM was given — computed only from bars
        on/before the decision date.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-y-3 gap-x-2">
        {keys.map((k) => {
          const v = readings[k];
          const isPct = k.endsWith("_pct");
          const num = typeof v === "number" ? v : null;
          const color =
            isPct && num != null ? (num >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-200";
          const shown = typeof v === "number" ? (isPct ? pct(v) : String(v)) : String(v);
          return (
            <div key={k}>
              <div className="text-[11px] text-zinc-500">{READING_LABEL[k] || k}</div>
              <div className={`text-sm font-medium ${color}`}>{shown}</div>
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

function backtestNote(m: BacktestMetrics): string | null {
  const full = m.excess_return_pct;
  const entry = m.excess_vs_entry_pct;
  if (full >= 0) return "Beat buy-and-hold over the full window.";
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
      {backtestNote(m) && (
        <p className="text-xs text-amber-400/80 mt-3">{backtestNote(m)}</p>
      )}
    </div>
  );
}

function TradesTable({ r }: { r: TechnicalResult }) {
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
