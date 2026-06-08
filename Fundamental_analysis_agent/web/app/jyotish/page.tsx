"use client";

import { useState } from "react";
import { createJyotish, pollJyotish, Task35Job, Graha } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = { bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30", neutral: "text-zinc-300 border-zinc-700 bg-zinc-900", cautious: "text-amber-400 border-amber-700 bg-amber-950/30" };
const REGIME: Record<string, string> = { benefic_dasha: "text-emerald-400 border-emerald-700 bg-emerald-950/30", malefic_dasha: "text-red-400 border-red-700 bg-red-950/30" };
const SIG: Record<string, string> = { buy_and_hold: "Buy & hold", benefic_dasha: "Hold during a benefic Mahādaśā", avoid_malefic_dasha: "Sit out malefic Mahādaśā" };
const RLABEL: Record<string, string> = { jyotish_regime: "Daśā regime", moon_nakshatra: "Moon nakṣatra", moon_rashi: "Moon rāśi", mahadasha_lord: "Mahādaśā lord", dasha_nature: "Nature", ayanamsa_deg: "Ayanāṃśa" };

export default function JyotishPage() {
  const [ticker, setTicker] = useState(""); const [job, setJob] = useState<Task35Job | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) { e.preventDefault(); const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createJyotish(t); setJob(j); pollJyotish(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); } }
  const r = job?.result ?? null; const c = r?.chart;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 35</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">Jyotiṣa · Vedic astrology · CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">Sidereal Vedic astrology: 9 grahas (tropical − Lahiri
        ayanāṃśa), the natal Moon&apos;s nakṣatra, and the <strong>Vimśottarī Mahādaśā</strong> (120-yr planetary-period cycle).
        Signal: hold during a benefic daśā (Jupiter/Venus/Mercury/Moon), sit out malefic. Worthless by design — that&apos;s the point.</p></section>
      <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
        <strong>⚠️ Control / placebo — no economic mechanism.</strong> Genuinely computable Vedic astrology (the Vimśottarī daśā is
        exact) run through the <em>identical</em> lookahead-free backtest, to calibrate the suite&apos;s false-positive rate. The
        Jyotiṣa reading is written by the LLM and ignored by the engine.</div>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. NVDA" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-purple-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-purple-800 hover:bg-purple-700 disabled:opacity-50">{busy ? "Casting…" : "Cast"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && c && (<div className="space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker} <span className="text-[11px] px-2 py-0.5 rounded border border-purple-700 bg-purple-950/30 text-purple-300 align-middle">PLACEBO</span></h2>
          <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-zinc-800 rounded-md p-4 space-y-2">
            <h3 className="text-sm font-semibold text-zinc-200">Rāśi chart (sidereal) — listing {c.listing_date}{c.listing_date_is_data_limit && <span className="text-[10px] text-amber-400"> (data limit)</span>}</h3>
            <table className="w-full text-xs"><thead className="text-zinc-500 text-left"><tr><th className="py-1 pr-3">Graha</th><th className="pr-3 text-right">Sidereal °</th><th>Rāśi</th></tr></thead>
              <tbody className="text-zinc-300">{c.grahas.map((g: Graha) => <tr key={g.name} className="border-t border-zinc-900"><td className="py-1 pr-3 font-medium">{g.name}</td><td className="pr-3 text-right tabular-nums">{g.sidereal_lon.toFixed(1)}</td><td>{g.rashi}</td></tr>)}</tbody></table>
            <div className="text-xs text-zinc-400 pt-1">Moon: <span className="text-zinc-200">{c.moon_nakshatra}</span> nakṣatra · {c.moon_rashi} · Mahādaśā <span className={c.dasha_nature === "benefic" ? "text-emerald-400" : "text-red-400"}>{c.mahadasha_lord} ({c.dasha_nature})</span></div>
          </div>
          <div className="border border-zinc-800 rounded-md p-4 space-y-2"><h3 className="text-sm font-semibold text-zinc-200">Reasoning chain</h3>
            <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((x, i) => <li key={i}>{x}</li>)}</ol></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Reading &amp; thesis</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
            <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
            <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
          <Backtest m={r.backtest.metrics} /></div>
        <Readings readings={r.jyotish_readings} labels={RLABEL} regimeKey="jyotish_regime" colors={REGIME} />
        <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
          <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
        <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
          <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
          <EquityChart curve={r.backtest.equity_curve} /></div>
        <Caveats caveats={r.caveats} /></div>)}
    </div>
  );
}
