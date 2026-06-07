"use client";

import { useState } from "react";
import {
  createEnsemble,
  pollEnsemble,
  Task5Job,
  EnsembleResult,
  EnsemblePolicy,
  SubAgentSummary,
  BacktestMetrics,
} from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";

const STANCE_COLOR: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};

const AGREEMENT_BADGE: Record<string, string> = {
  agree: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  conflict: "text-amber-400 border-amber-700 bg-amber-950/30",
  partial: "text-zinc-300 border-zinc-700 bg-zinc-900",
  single_leg: "text-blue-400 border-blue-800 bg-blue-950/30",
};

const AGREEMENT_LABEL: Record<string, string> = {
  agree: "agents agree", conflict: "agents conflict",
  partial: "one view leads", single_leg: "single leg only",
};

const MODE_LABEL: Record<string, string> = {
  and: "AND — invest only on consensus",
  or: "OR — invest when either is long",
  weighted: "Weighted blend of both",
  fundamental_gated_technical: "Technical timing, sized by fundamental conviction",
  defer_fundamental: "Defer to the fundamental agent",
  defer_technical: "Defer to the technical agent",
};

const SIGNAL_LABEL: Record<string, string> = {
  buy_and_hold: "Buy & hold", sma_cross: "SMA crossover", macd_cross: "MACD cross",
  momentum: "Momentum breakout", rsi_oversold: "RSI oversold (accumulate)",
  bollinger_breakout: "Bollinger breakout", donchian_breakout: "Donchian breakout",
  hold: "Hold to end", sma_reverse: "SMA reverse cross", macd_reverse: "MACD reverse cross",
  rsi_overbought: "RSI overbought", bollinger_revert: "Bollinger mean-revert",
  donchian_stop: "Donchian stop", time_exit: "Time exit",
};

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function EnsemblePage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task5Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createEnsemble(t);
      setJob(j);
      pollEnsemble(j.job_id, (next) => {
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
          <h1 className="text-2xl font-semibold">Task 5</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Fundamental + Technical → Arbiter → Combined Backtest
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We run the <strong>fundamental</strong> agent (Task 3, from the
          latest 10-K) and the <strong>technical</strong> agent (Task 4, from as-of indicator
          readings) over one common window, then an LLM <strong>arbiter</strong> decides how to
          combine them — picking one policy from a fixed menu (AND / OR / weighted / gated /
          defer). The arbiter sees each agent&apos;s <em>reasoning</em> but{" "}
          <strong>not its realized returns</strong>, so the combine policy can&apos;t be fit to
          the test window. The combined position is then backtested, lookahead-free, against
          buy-and-hold and the S&amp;P 500.
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
          {busy && " · running both agents, arbitrating, backtesting…"}
        </p>
      )}

      {job?.status === "failed" && (
        <p className="text-red-400 text-sm">{job.error_message}</p>
      )}

      {result && <ResultView r={result} />}
    </div>
  );
}

function ResultView({ r }: { r: EnsembleResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">
          {r.ticker}
          {r.company_name && r.company_name !== r.ticker && (
            <span className="text-sm text-zinc-500 font-normal"> · {r.company_name}</span>
          )}
        </h2>
        <span className="text-xs text-zinc-500">
          as-of {r.as_of_date} · common window from {r.common_window_start}
          {" · "}cost ${r.cost_usd.toFixed(4)}
        </span>
      </div>

      <ArbiterPanel p={r.policy} />

      {/* The two agents, side by side — the core of the ensemble narrative */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LegCard leg={r.fundamental} />
        <LegCard leg={r.technical} />
      </div>

      {/* Candlestick */}
      <div className="border border-zinc-800 rounded-md p-3">
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">Price (split/dividend-adjusted)</h3>
        <p className="text-xs text-zinc-500 mb-2">
          <span className="text-emerald-400">▲</span> ensemble entry ·{" "}
          <span className="text-red-400">▼</span> ensemble exit ·{" "}
          <span className="text-amber-400">┊</span> common window start
        </p>
        <CandlestickChart
          prices={r.prices}
          trades={r.backtest.trades}
          filingDate={r.common_window_start}
          markerLabel="window start"
        />
      </div>

      <EnsembleBacktestPanel r={r} />

      {/* Equity curve — ensemble vs buy & hold vs market */}
      <div className="border border-zinc-800 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-300">Combined-position equity curve</h3>
          <p className="text-xs">
            <span className="text-emerald-400">━ ensemble</span>{"   "}
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

function ArbiterPanel({ p }: { p: EnsemblePolicy }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3 bg-zinc-950/40">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-zinc-200">Arbiter decision</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${AGREEMENT_BADGE[p.agreement] || ""}`}>
          {AGREEMENT_LABEL[p.agreement] || p.agreement}
        </span>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[p.resolved_stance] || ""}`}>
          house view: {p.resolved_stance}
        </span>
      </div>
      <div className="text-xs text-zinc-400">
        Combine policy:{" "}
        <span className="text-zinc-100 font-medium">{MODE_LABEL[p.combine_mode] || p.combine_mode}</span>
        {p.combine_mode === "weighted" && (
          <span className="text-zinc-500">
            {"  "}(fundamental {Math.round(p.fundamental_weight * 100)}% · technical{" "}
            {Math.round(p.technical_weight * 100)}%)
          </span>
        )}
      </div>
      {p.arbitration_thesis && (
        <p className="text-sm text-zinc-300 leading-relaxed">{p.arbitration_thesis}</p>
      )}
      {p.conflict_resolution && (
        <p className="text-xs text-zinc-500 leading-relaxed">
          <span className="text-zinc-400">Reconciliation:</span> {p.conflict_resolution}
        </p>
      )}
    </div>
  );
}

function LegCard({ leg }: { leg: SubAgentSummary }) {
  const title = leg.agent === "fundamental" ? "Fundamental agent" : "Technical agent";
  const sub = leg.agent === "fundamental" ? "Task 3 · from the 10-K" : "Task 4 · as-of readings";

  if (!leg.available) {
    return (
      <div className="border border-zinc-800 rounded-md p-4 space-y-2 opacity-80">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-300">{title}</h3>
          <span className="text-[11px] px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-500">
            unavailable
          </span>
        </div>
        <p className="text-xs text-zinc-500">{sub}</p>
        <p className="text-xs text-amber-400/80">{leg.note || "This leg could not be produced for this ticker."}</p>
      </div>
    );
  }

  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        {leg.stance && (
          <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[leg.stance] || ""}`}>
            {leg.stance}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500">{sub}</p>
      <div className="text-xs text-zinc-400">
        <span className="text-zinc-200">{SIGNAL_LABEL[leg.entry_signal || ""] || leg.entry_signal}</span>
        {leg.exit_signal && (
          <>
            {" → exit on "}
            <span className="text-zinc-200">{SIGNAL_LABEL[leg.exit_signal] || leg.exit_signal}</span>
          </>
        )}
      </div>
      {leg.thesis && <p className="text-sm text-zinc-300 leading-relaxed line-clamp-4">{leg.thesis}</p>}
      <div className="grid grid-cols-2 gap-y-2 gap-x-2 border-t border-zinc-800 pt-3">
        <Metric label="Return · this window" value={leg.total_return_pct != null ? pct(leg.total_return_pct) : "—"}
                good={leg.total_return_pct != null ? leg.total_return_pct >= 0 : null} />
        <Metric label="Alpha vs market" value={leg.excess_vs_market_pct != null ? pct(leg.excess_vs_market_pct) : "—"}
                good={leg.excess_vs_market_pct != null ? leg.excess_vs_market_pct >= 0 : null} />
        <Metric label="Sharpe" value={leg.sharpe != null ? leg.sharpe.toFixed(2) : "—"}
                good={leg.sharpe != null ? leg.sharpe >= 1 : null} />
        <Metric label="Trades" value={leg.n_trades != null ? String(leg.n_trades) : "—"} />
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

function EnsembleBacktestPanel({ r }: { r: EnsembleResult }) {
  const m = r.backtest.metrics;
  const hasEntryBench = m.benchmark_from_entry_pct != null;
  // How did the ensemble do relative to its own legs? (legs re-backtested on the same window)
  const legReturns = [r.fundamental.total_return_pct, r.technical.total_return_pct]
    .filter((x): x is number => x != null);
  const bestLeg = legReturns.length ? Math.max(...legReturns) : null;
  let verdict: string | null = null;
  if (bestLeg != null) {
    if (m.total_return_pct >= bestLeg - 0.01) verdict =
      "The fusion matched or beat the better of the two agents alone over this window.";
    else verdict =
      "The fusion came in below the better single agent over this window — combining cost return here " +
      "(often the price of the more conservative exposure). Shown honestly.";
  }
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">
        Ensemble backtest{" "}
        <span className="text-xs text-zinc-500 font-normal">({m.days} days, {m.transaction_cost_bps} bps/side turnover)</span>
      </h3>
      <div className="grid grid-cols-3 gap-y-3 gap-x-2 mb-3">
        <Metric label="Ensemble" value={pct(m.total_return_pct)} good={m.total_return_pct >= 0} />
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
        <Metric label="Episodes" value={String(m.n_trades)} />
        <Metric label="Exposure" value={`${m.exposure_pct.toFixed(0)}%`} />
      </div>
      {verdict && <p className="text-xs text-amber-400/80 mt-3">{verdict}</p>}
    </div>
  );
}

function TradesTable({ trades }: { trades: EnsembleResult["backtest"]["trades"] }) {
  if (trades.length === 0) {
    return (
      <div className="border border-zinc-800 rounded-md p-4 text-sm text-zinc-500">
        The combined position never went long in the backtest window.
      </div>
    );
  }
  return (
    <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">
        Position episodes ({trades.length})
        <span className="text-xs text-zinc-500 font-normal"> · contiguous in-market spans of the combined book</span>
      </h3>
      <table className="w-full text-xs">
        <thead className="text-zinc-500 text-left">
          <tr>
            <th className="py-1 pr-3">Enter</th><th className="pr-3">@</th>
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
