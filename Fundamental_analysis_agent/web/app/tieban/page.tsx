"use client";

import { useState } from "react";
import { createTieban, pollTieban, Task31Job, TiebanResult, TiebanPillar } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  auspicious: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  inauspicious: "text-red-400 border-red-700 bg-red-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", verse_fortune: "流年得吉條則持有", avoid_inauspicious: "流年逢凶條則空手",
};
const RLABEL: Record<string, string> = {
  tieban_regime: "流年判定", ming_number: "命數(太極數)", liunian_verse_no: "流年條文#",
  liunian_verdict: "斷", liunian_gua: "流年卦象",
};

function ControlBanner() {
  return (
    <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
      <strong>⚠️ Control / placebo — and a double one.</strong> 鐵板神數&apos;s real 條文 萬言書 is proprietary/legendary
      (no public algorithm), so this uses a deterministic <strong>太玄數 起例</strong> over the natal 四柱 as an honest
      stand-in — which itself has no economic mechanism. Same lookahead-free backtest, to calibrate the suite&apos;s
      false-positive rate. The 條文 verse is written by the LLM and ignored by the engine.
    </div>
  );
}

export default function TiebanPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task31Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createTieban(t); setJob(j); pollTieban(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  const c = r?.chart;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 31</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">鐵板神數（太玄起數）· CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">以上市日四柱起太玄數，得命數（太極數）；流年條文編號＝命數＋流年干支數，
        編號定吉凶。訊號：流年得吉條則持有、逢凶條則空手。LLM 寫條文，引擎照樣忽略。真鐵板條文係祕傳，此為確定性替身 —— 刻意毫無預測力。</p></section>
      <ControlBanner />
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. NVDA"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-purple-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-purple-800 hover:bg-purple-700 disabled:opacity-50">{busy ? "起數中…" : "起數"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && c && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker} <span className="text-[11px] px-2 py-0.5 rounded border border-purple-700 bg-purple-950/30 text-purple-300 align-middle">PLACEBO</span></h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3">
              <h3 className="text-sm font-semibold text-zinc-200">起數 — 上市 {c.listing_date}{c.listing_date_is_data_limit && <span className="text-[10px] text-amber-400"> （資料起點）</span>}</h3>
              <div className="grid grid-cols-4 gap-2">{c.pillars.map((p: TiebanPillar) => (
                <div key={p.role} className="border border-zinc-800 rounded-md p-3 text-center bg-zinc-950/40">
                  <div className="text-[11px] text-zinc-500">{p.role}柱</div>
                  <div className="text-2xl font-semibold text-zinc-100">{p.gz}</div>
                  <div className="text-[11px] text-amber-300 mt-1">太玄 {p.taixuan}</div>
                </div>))}</div>
              <div className="text-xs text-zinc-400 space-y-0.5 pt-1">
                <div>命數（太極數）＝<span className="text-amber-300">{c.ming_number}</span></div>
                <div>流年條文 #<span className="text-zinc-100">{c.liunian_verse_no}</span> → <span className={c.liunian_verdict === "吉" ? "text-emerald-400" : c.liunian_verdict === "凶" ? "text-red-400" : "text-zinc-400"}>{c.liunian_verdict}</span> · 卦象 {c.liunian_gua}</div>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">推理鏈</h3>
              <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((x, i) => <li key={i}>{x}</li>)}</ol>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">條文 &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.tieban_readings} labels={RLABEL} regimeKey="tieban_regime" colors={REGIME} />
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
