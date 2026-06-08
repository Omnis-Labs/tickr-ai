"use client";

import { useState } from "react";
import { createQizheng, pollQizheng, Task30Job, QizhengResult, QizhengStar } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  benefic_blessing: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  malefic_affliction: "text-red-400 border-red-700 bg-red-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", benefic_transit: "歲星拱命主則持有", avoid_malefic: "火羅沖命主則空手",
};
const RLABEL: Record<string, string> = {
  qizheng_regime: "流年判定", ming_zhu_sign: "命主(太陽)", jupiter_sign: "歲星(木)", mars_sign: "火星",
  rahu_sign: "羅睺", jupiter_blesses: "歲星拱命", malefic_afflicts: "凶曜沖命",
};

function ControlBanner() {
  return (
    <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
      <strong>⚠️ Control / placebo agent — no economic mechanism.</strong> 七政四餘 is real Chinese horoscopic
      astrology — 七政 (日月+五星) and 四餘 (羅睺/計都/月孛/紫炁) computed from <strong>ephem</strong>. The signal rides
      benefic/malefic transits vs the natal Sun through the <em>identical</em> lookahead-free backtest, to calibrate the
      suite&apos;s false-positive rate. The 星命 reading is written by the LLM and ignored by the engine.
    </div>
  );
}

function StarRow({ s }: { s: QizhengStar }) {
  return (
    <tr className="border-t border-zinc-900"><td className="py-1 pr-3 font-medium">{s.name}</td>
      <td className="pr-3 text-right tabular-nums">{s.ecliptic_lon.toFixed(1)}°</td><td className="pr-3 text-zinc-400">{s.sign}</td></tr>
  );
}

export default function QizhengPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task30Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createQizheng(t); setJob(j); pollQizheng(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  const c = r?.chart;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 30</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">七政四餘（中華星命）· CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">以上市日立命，排七政（日月＋水金火木土）與四餘（羅睺／計都／月孛／紫炁）之躔度。
        訊號：歲星拱照命主則持有、火羅沖命主則空手。LLM 寫星命書，引擎照樣忽略。刻意毫無預測力 —— 正是重點。</p></section>
      <ControlBanner />
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. NVDA"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-purple-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-purple-800 hover:bg-purple-700 disabled:opacity-50">{busy ? "推星中…" : "推星"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && c && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker} <span className="text-[11px] px-2 py-0.5 rounded border border-purple-700 bg-purple-950/30 text-purple-300 align-middle">PLACEBO</span></h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">星盤 — 上市 {c.listing_date}{c.listing_date_is_data_limit && <span className="text-[10px] text-amber-400"> （資料起點）</span>} · 命主 {c.ming_zhu_sign}</h3>
              <div className="grid grid-cols-2 gap-x-4">
                <table className="w-full text-xs"><thead><tr className="text-zinc-500 text-left"><th className="pb-1">七政</th><th></th><th></th></tr></thead><tbody className="text-zinc-300">{c.seven.map((s) => <StarRow key={s.name} s={s} />)}</tbody></table>
                <table className="w-full text-xs"><thead><tr className="text-zinc-500 text-left"><th className="pb-1">四餘</th><th></th><th></th></tr></thead><tbody className="text-zinc-300">{c.siyu.map((s) => <StarRow key={s.name} s={s} />)}</tbody></table>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">推理鏈</h3>
              <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((x, i) => <li key={i}>{x}</li>)}</ol>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">星命書 &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.qizheng_readings} labels={RLABEL} regimeKey="qizheng_regime" colors={REGIME} />
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
