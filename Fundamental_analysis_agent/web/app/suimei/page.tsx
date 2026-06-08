"use client";

import { useState } from "react";
import { createSuimei, pollSuimei, Task29Job, SuimeiResult, SuimeiPillar } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  thriving: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  declining: "text-amber-400 border-amber-700 bg-amber-950/30",
  tenchusatsu: "text-red-400 border-red-700 bg-red-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", twelve_fortune: "持有當流年為旺運（長生/冠帶/臨官/帝旺）", avoid_tenchusatsu: "天中殺年空手",
};
const RLABEL: Record<string, string> = {
  suimei_regime: "流年判定", day_master: "日主", tenchusatsu: "天中殺", liunian_branch: "流年支",
  liunian_twelve_fortune: "流年十二運", in_tenchusatsu: "落天中殺",
};
const THRIVING = new Set(["長生", "冠帶", "臨官", "帝旺"]);
const WEAK = new Set(["病", "死", "墓", "絕"]);
function fortuneColor(f: string) { return THRIVING.has(f) ? "text-emerald-400" : WEAK.has(f) ? "text-red-400" : "text-zinc-400"; }

function ControlBanner() {
  return (
    <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
      <strong>⚠️ Control / placebo agent — no economic mechanism.</strong> Japanese 四柱推命 (京都泰山流)
      reads the same 干支 pillars but centres on <strong>十二運星</strong> (the 長生→帝旺→絕 life-stage cycle)
      and <strong>天中殺 (空亡)</strong> — the axes 細木数子's 六星占術 / 動物占い grew from. Same lookahead-free
      backtest, worthless signal — to calibrate the suite's false-positive rate. The 鑑定書 is written by the LLM
      and ignored by the engine.
    </div>
  );
}

function PillarCard({ p }: { p: SuimeiPillar }) {
  return (
    <div className="border border-zinc-800 rounded-md p-3 text-center bg-zinc-950/40">
      <div className="text-[11px] text-zinc-500">{p.role}柱</div>
      <div className="text-2xl font-semibold leading-tight text-zinc-100">{p.stem}{p.branch}</div>
      <div className={`text-xs mt-1 ${fortuneColor(p.twelve_fortune)}`}>{p.twelve_fortune}</div>
      <div className="text-[10px] text-zinc-600 mt-0.5">藏干 {p.hidden.join("")}</div>
    </div>
  );
}

export default function SuimeiPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task29Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createSuimei(t); setJob(j); pollSuimei(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  const c = r?.chart;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 29</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">四柱推命（京都泰山流）· CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">日版四柱：同樣的干支四柱，卻以<strong>十二運星</strong>
        （長生→帝旺→絕的旺衰循環）與<strong>天中殺（空亡）</strong>為論命主軸。訊號：流年逢旺運則持有、逢天中殺則空手（細木数子「天中殺宜潛伏」之理）。
        LLM 寫鑑定書，引擎照樣忽略。刻意毫無預測力 —— 正是重點。</p></section>
      <ControlBanner />
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. NVDA"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-purple-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-purple-800 hover:bg-purple-700 disabled:opacity-50">{busy ? "鑑定中…" : "鑑定"}</button>
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
              <h3 className="text-sm font-semibold text-zinc-200">命式 — 上市 {c.listing_date}{c.listing_date_is_data_limit && <span className="text-[10px] text-amber-400"> （資料起點）</span>}</h3>
              <div className="grid grid-cols-4 gap-2">{c.pillars.map((p) => <PillarCard key={p.role} p={p} />)}</div>
              <div className="text-xs text-zinc-400 space-y-0.5 pt-1">
                <div>日主：<span className="text-zinc-100">{c.day_master}（{c.day_master_elem}）</span></div>
                <div>天中殺（空亡）：<span className="text-red-400">{c.tenchusatsu}</span></div>
                <div>流年 {c.liunian_branch}：十二運 <span className={fortuneColor(c.liunian_fortune)}>{c.liunian_fortune}</span>{c.liunian_in_tenchusatsu && <span className="text-red-400"> · 落天中殺</span>}</div>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">推理鏈</h3>
              <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((x, i) => <li key={i}>{x}</li>)}</ol>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">鑑定書 &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.suimei_readings} labels={RLABEL} regimeKey="suimei_regime" colors={REGIME} />
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
