"use client";

import { useState } from "react";
import { createAstro, pollAstro, Task25Job, AstroResult } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  direct: "text-zinc-300 border-zinc-700 bg-zinc-900",
  mercury_retrograde: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", avoid_mercury_retrograde: "Avoid Mercury retrograde",
  moon_phase_long: "Long the waxing moon", benefic_aspect: "Long on benefic aspect",
};
const RLABEL: Record<string, string> = {
  astro_regime: "Regime", mercury_retrograde: "Mercury ℞", moon_illumination_pct: "Moon illum %",
  moon_phase: "Moon phase", sun_sign: "Sun sign", n_aspects: "Aspects",
};

function ControlBanner() {
  return (
    <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
      <strong>⚠️ Control / placebo agent — no economic mechanism.</strong> Financial astrology runs the
      <em> identical</em> lookahead-free backtest as the real agents on a predictively-worthless signal, to
      calibrate the suite&apos;s false-positive rate. If this prints a high Sharpe, the framework is leaking —
      not the planets working. Planetary positions are a pure function of the date, so it&apos;s if anything{" "}
      <em>more</em> lookahead-free than the filing-based agents.
    </div>
  );
}

export default function AstroPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task25Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createAstro(t); setJob(j); pollAstro(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 25</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">Financial Astrology · CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">A deliberately worthless signal —
        Mercury retrograde, moon phase, planetary aspects — run through the same honest backtest as everything
        else. The LLM writes the horoscope; the engine ignores it.</p></section>
      <ControlBanner />
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-purple-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-purple-800 hover:bg-purple-700 disabled:opacity-50">{busy ? "Casting…" : "Cast chart"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker} <span className="text-[11px] px-2 py-0.5 rounded border border-purple-700 bg-purple-950/30 text-purple-300 align-middle">PLACEBO</span></h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">星盤 — as-of chart</h3>
              <table className="w-full text-xs"><tbody className="text-zinc-300">
                {r.chart.map((p) => <tr key={p.body} className="border-t border-zinc-900"><td className="py-1 pr-3 font-medium">{p.body}</td><td className="pr-3 text-right tabular-nums">{p.ecliptic_lon.toFixed(1)}°</td><td className="pr-3">{p.sign}</td><td className={p.retrograde ? "text-amber-400" : "text-zinc-600"}>{p.retrograde ? "℞ retrograde" : "direct"}</td></tr>)}
              </tbody></table>
              {r.aspects.length > 0 && <p className="text-[11px] text-zinc-500 pt-1">aspects: {r.aspects.join(" · ")}</p>}
            </div>
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">Reasoning chain</h3>
              <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((c, i) => <li key={i}>{c}</li>)}</ol>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Horoscope &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.astro_readings} labels={RLABEL} regimeKey="astro_regime" colors={REGIME} />
          <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
            <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
          <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
            <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
            <EquityChart curve={r.backtest.equity_curve} /></div>
          <Caveats caveats={r.caveats} />
        </div>
      )}
    </div>
  );
}
