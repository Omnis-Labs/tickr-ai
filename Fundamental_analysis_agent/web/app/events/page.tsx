"use client";

import { useState } from "react";
import { createEvents, pollEvents, Task18Job, EventResult, EventSpec, EventRecord } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  activist_active: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  quiet: "text-zinc-300 border-zinc-700 bg-zinc-900",
  red_flag_recent: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const POL: Record<string, string> = { positive: "text-emerald-400", neutral: "text-zinc-400", negative: "text-red-400" };
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", activist_drift: "Activist (13D) drift", avoid_redflags: "Avoid red-flag windows",
};
const RLABEL: Record<string, string> = {
  event_regime: "Regime", n_activist_13d: "Activist 13D", n_red_flags: "Red flags", n_dilution: "Dilution",
  n_late_filing: "Late filings", n_adverse_exec: "Exec departures", days_since_last_13d: "Days since 13D",
  days_since_last_red_flag: "Days since red flag",
};

export default function EventsPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task18Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createEvents(t); setJob(j); pollEvents(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 18</h1>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Corporate Events (8-K / 13D) → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">Enter a ticker. From SEC filings we flag{" "}
        <strong>Schedule 13D</strong> activist stakes (a positive drift signal) and <strong>red flags</strong> — dilution
        (424B5/S-3), late filings (NT 10-K/Q), auditor changes, delisting notices, and <strong>adverse executive departures</strong>{" "}
        (8-K 5.02, where the LLM reads the text to tell a forced exit from a planned retirement). Keyed off the filing date;
        long-only — ride activist drift, stand aside on red flags.</p></section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. BHC"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code>{busy && " · scanning filings, classifying 8-K 5.02s, backtesting…"}</p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker}<span className="text-sm text-zinc-500 font-normal"> · {r.company_name}</span></h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · {r.n_events} events · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
            <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><Thesis s={r.strategy} /><Backtest m={r.backtest.metrics} /></div>
          <Readings readings={r.event_readings} labels={RLABEL} regimeKey="event_regime" colors={REGIME} />
          {r.events.length > 0 && (
            <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto"><h3 className="text-sm font-semibold text-zinc-200 mb-2">Recent corporate events</h3>
              <table className="w-full text-xs"><thead className="text-zinc-500 text-left"><tr><th className="py-1 pr-3">Filed</th><th className="pr-3">Kind</th><th className="pr-3">Polarity</th><th className="pr-3">Note</th></tr></thead>
                <tbody className="text-zinc-300">{[...r.events].reverse().map((e, i) => <tr key={i} className="border-t border-zinc-900"><td className="py-1 pr-3 whitespace-nowrap">{e.date}</td><td className="pr-3">{e.kind.replace(/_/g, " ")}</td><td className={`pr-3 ${POL[e.polarity]}`}>{e.polarity}</td><td className="pr-3 text-zinc-500">{e.note}</td></tr>)}</tbody></table></div>
          )}
          <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
            <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
            <EquityChart curve={r.backtest.equity_curve} /></div>
          <Caveats caveats={r.caveats} />
        </div>
      )}
    </div>
  );
}

function Thesis({ s }: { s: EventSpec }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
      <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[s.stance] || ""}`}>{s.stance}</span></div>
      <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[s.entry_signal] || s.entry_signal}</span>{s.entry_signal === "activist_drift" && <span> · hold {s.holding_days}d</span>}{s.entry_signal === "avoid_redflags" && <span> · avoid {s.redflag_window_days}d</span>}{s.stop_loss_pct > 0 && <span> · stop {s.stop_loss_pct}%</span>}</div>
      <p className="text-sm text-zinc-300 leading-relaxed">{s.thesis}</p>{s.rationale && <p className="text-xs text-zinc-500">{s.rationale}</p>}</div>
  );
}
