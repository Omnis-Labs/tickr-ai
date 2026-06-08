"use client";

import { useState } from "react";
import { createBazi, pollBazi, Task27Job, BaziResult, Pillar } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  favourable_year: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  unfavourable_year: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", favorable_year: "持有當流年屬喜用", favorable_month: "持有當流月屬喜用",
};
const RLABEL: Record<string, string> = {
  bazi_regime: "流年判定", day_master: "日主", strength: "旺衰", favourable_elements: "喜用神",
  current_liunian_elem: "當前流年五行", element_spread: "五行分布",
};
// five-element → colour for the chart glyphs
const ELEM_COLOR: Record<string, string> = {
  木: "text-emerald-400", 火: "text-red-400", 土: "text-amber-400", 金: "text-zinc-200", 水: "text-blue-400",
};

function ControlBanner() {
  return (
    <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
      <strong>⚠️ Control / placebo agent — no economic mechanism.</strong> 八字 casts the company&apos;s natal
      chart from its <strong>listing date</strong> and runs the <em>identical</em> lookahead-free backtest as the
      real agents — to calibrate the suite&apos;s false-positive rate. The 命書 is written by the LLM and
      <strong> ignored</strong> by the engine. A single reading on a hand-picked winner can look great by selection
      bias; only the 480-draw <a href="/meihua" className="underline">null distribution</a> is honest.
    </div>
  );
}

function PillarCard({ p }: { p: Pillar }) {
  return (
    <div className="border border-zinc-800 rounded-md p-3 text-center bg-zinc-950/40">
      <div className="text-[11px] text-zinc-500">{p.role}柱</div>
      <div className={`text-2xl font-semibold leading-tight ${ELEM_COLOR[p.stem_elem] || "text-zinc-200"}`}>{p.stem}</div>
      <div className={`text-2xl font-semibold leading-tight ${ELEM_COLOR[p.branch_elem] || "text-zinc-200"}`}>{p.branch}</div>
      <div className="text-[10px] text-zinc-500 mt-1">{p.stem_elem}/{p.branch_elem} · {p.zodiac}</div>
    </div>
  );
}

export default function BaziPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task27Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createBazi(t); setJob(j); pollBazi(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  const c = r?.chart;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 27</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">八字（四柱）· CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">以公司的<strong>上市日</strong>為「生辰」起四柱，
        讀出日主與旺衰、定喜用神，再以當前<strong>流年／流月五行</strong>是否為喜用來決定 多／空手。LLM 寫命書，引擎照樣忽略它。
        刻意毫無預測力 —— 這正是重點。</p></section>
      <ControlBanner />
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. NVDA"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-purple-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-purple-800 hover:bg-purple-700 disabled:opacity-50">{busy ? "排盤中…" : "排盤"}</button>
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
              <h3 className="text-sm font-semibold text-zinc-200">命盤 — 上市 {c.listing_date}{c.listing_date_is_data_limit && <span className="text-[10px] text-amber-400"> （資料起點，非真實 IPO）</span>}</h3>
              <div className="grid grid-cols-4 gap-2">{c.pillars.map((p) => <PillarCard key={p.role} p={p} />)}</div>
              <div className="text-xs text-zinc-400 space-y-0.5 pt-1">
                <div>日主：<span className={ELEM_COLOR[c.dm_elem]}>{c.day_master}（{c.dm_elem}）</span> · {c.strength_label}</div>
                <div>喜用神：{c.favourable.map((e) => <span key={e} className={`${ELEM_COLOR[e]} mr-1`}>{e}</span>)}</div>
                <div>五行分布：{Object.entries(c.element_counts).map(([k, v]) => <span key={k} className={`${ELEM_COLOR[k]} mr-2`}>{k}{v}</span>)}</div>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">推理鏈</h3>
              <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((x, i) => <li key={i}>{x}</li>)}</ol>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">命書 &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.bazi_readings} labels={RLABEL} regimeKey="bazi_regime" colors={REGIME} />
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
