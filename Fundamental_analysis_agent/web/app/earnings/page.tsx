"use client";

import { useState } from "react";
import {
  createEarnings,
  pollEarnings,
  Task8Job,
  EarningsResult,
  EarningsEvent,
  EarningsSpec,
  BacktestMetrics,
} from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";

const STANCE_COLOR: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};

const SENT_COLOR: Record<string, string> = {
  bullish: "text-emerald-400", neutral: "text-zinc-400", bearish: "text-red-400",
};

const SIGNAL_LABEL: Record<string, string> = {
  any_earnings: "After every earnings release", bullish: "After bullish releases",
  bullish_or_raised: "After bullish / raised-guidance", beat: "After an earnings beat",
  time_exit: "Time exit", next_earnings: "Hold to next earnings",
};

const READING_LABEL: Record<string, string> = {
  earnings_regime: "Earnings regime", n_events: "Releases", last_event_date: "Last release",
  last_sentiment: "Last sentiment", last_guidance: "Last guidance", last_beat_miss: "Last beat/miss",
  n_bullish: "Bullish", n_bearish: "Bearish", n_raised_guidance: "Raised guidance",
  n_beats: "Beats", days_since_last_earnings: "Days since last",
};

function pct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }

export default function EarningsPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task8Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createEarnings(t);
      setJob(j);
      pollEarnings(j.job_id, (next) => {
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
          <h1 className="text-2xl font-semibold">Task 8</h1>
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Earnings (8-K) → Strategy → PEAD Backtest
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          Enter a ticker. We fetch its recent earnings <strong>press releases</strong> (SEC 8-K,
          Item 2.02 / Exhibit 99.1), an LLM classifies each one <strong>as-of its filing date</strong>{" "}
          (sentiment / guidance / beat-miss, with a citation), then it picks one event-driven
          strategy that trades the <strong>post-earnings-announcement drift</strong>. A lookahead-free
          backtest acts only on the open after each filing. This reads the <em>press release</em>,
          not the live call Q&amp;A transcript — the source is pluggable.
        </p>
      </section>

      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none"
        />
        <button type="submit" disabled={busy}
          className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed">
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
          {busy && " · fetching earnings 8-Ks, classifying releases, backtesting…"}
        </p>
      )}

      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}

      {result && <ResultView r={result} />}
    </div>
  );
}

function ResultView({ r }: { r: EarningsResult }) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{r.ticker}</h2>
        <span className="text-xs text-zinc-500">
          as-of {r.as_of_date} · {r.n_releases} earnings 8-Ks · cost ${r.cost_usd.toFixed(4)}
        </span>
      </div>

      <div className="border border-zinc-800 rounded-md p-3">
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">Price (split/dividend-adjusted)</h3>
        <p className="text-xs text-zinc-500 mb-2">
          <span className="text-emerald-400">▲</span> entry · <span className="text-red-400">▼</span> exit ·{" "}
          <span className="text-amber-400">┊</span> backtest window start
        </p>
        <CandlestickChart prices={r.prices} trades={r.backtest.trades}
          filingDate={r.backtest.start_date} markerLabel="window start" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ThesisPanel s={r.strategy} />
        <BacktestPanel m={r.backtest.metrics} />
      </div>

      <ReadingsPanel readings={r.earnings_readings} />
      <EventsTable events={r.events} />

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

function ThesisPanel({ s }: { s: EarningsSpec }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE_COLOR[s.stance] || ""}`}>{s.stance}</span>
      </div>
      <div className="text-xs text-zinc-400">
        <span className="text-zinc-200">{SIGNAL_LABEL[s.entry_signal] || s.entry_signal}</span>
        {" → "}<span className="text-zinc-200">{SIGNAL_LABEL[s.exit_signal] || s.exit_signal}</span>
        {s.exit_signal === "time_exit" && <span> · hold {s.holding_days}d</span>}
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
  const regime = readings["earnings_regime"];
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Earnings readings (as-of)</h3>
        {typeof regime === "string" && (
          <span className="text-[11px] px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-300">
            {regime.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-3 gap-x-2">
        {Object.keys(READING_LABEL).filter((k) => k in readings && k !== "earnings_regime").map((k) => (
          <div key={k}>
            <div className="text-[11px] text-zinc-500">{READING_LABEL[k]}</div>
            <div className="text-sm font-medium text-zinc-200">{String(readings[k])}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventsTable({ events }: { events: EarningsEvent[] }) {
  if (!events.length) {
    return (
      <div className="border border-zinc-800 rounded-md p-4 text-sm text-zinc-500">
        No earnings releases found in the window.
      </div>
    );
  }
  return (
    <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Classified earnings releases ({events.length})</h3>
      <table className="w-full text-xs">
        <thead className="text-zinc-500 text-left">
          <tr><th className="py-1 pr-3">Filed</th><th className="pr-3">Sentiment</th>
            <th className="pr-3">Guidance</th><th className="pr-3">Beat/miss</th><th className="pr-3">Citation</th></tr>
        </thead>
        <tbody className="text-zinc-300">
          {[...events].reverse().map((e, i) => (
            <tr key={i} className="border-t border-zinc-900 align-top">
              <td className="py-1 pr-3 whitespace-nowrap">{e.filing_date}</td>
              <td className={`pr-3 ${SENT_COLOR[e.sentiment]}`}>{e.sentiment}</td>
              <td className="pr-3 text-zinc-400">{e.guidance}</td>
              <td className="pr-3 text-zinc-400">{e.beat_miss}</td>
              <td className="pr-3 text-zinc-500 italic">{e.quote ? `“${e.quote}”` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        PEAD backtest <span className="text-xs text-zinc-500 font-normal">({m.days} days, {m.transaction_cost_bps} bps/side)</span>
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
