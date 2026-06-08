"use client";

import { useState } from "react";
import { createZiwei, pollZiwei, Task28Job, ZiweiResult, ZiweiChart, ZiweiPalace } from "@/lib/api";
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
  buy_and_hold: "Buy & hold", sihua_year: "持有當流年四化吉入命財官", sihua_month: "持有當流月四化吉入命財官",
};
const RLABEL: Record<string, string> = {
  ziwei_regime: "流年判定", soul_star: "命宮主星", body_star: "身宮主星", five_elements_class: "五行局",
  liunian_stem: "流年天干", liunian_sihua: "流年四化", sihua_landing: "飛星落宮",
};
// 4×4 board: 12 branches around the border (巳午未申 top, 寅丑子亥 bottom), centre = info
const POS: Record<string, [number, number]> = {
  巳: [1, 1], 午: [1, 2], 未: [1, 3], 申: [1, 4],
  辰: [2, 1], 酉: [2, 4], 卯: [3, 1], 戌: [3, 4],
  寅: [4, 1], 丑: [4, 2], 子: [4, 3], 亥: [4, 4],
};
const HUA_COLOR: Record<string, string> = { 化祿: "text-emerald-400", 化權: "text-blue-400", 化科: "text-purple-300", 化忌: "text-red-400" };

function ControlBanner() {
  return (
    <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
      <strong>⚠️ Control / placebo agent — no economic mechanism.</strong> 紫微斗數 casts the company&apos;s 命盤
      from its <strong>listing date</strong> and trades the <strong>四化飛星</strong> (does the year&apos;s 化祿/化權/化忌
      fly into 命宮/財帛/官祿?) through the <em>identical</em> lookahead-free backtest — to calibrate the suite&apos;s
      false-positive rate. The 命書 is written by the LLM and <strong>ignored</strong> by the engine.
    </div>
  );
}

function Board({ c }: { c: ZiweiChart }) {
  // palace-name → 飛星 badges (which 化 flew into it this 流年)
  const badges: Record<string, string[]> = {};
  Object.entries(c.sihua_landing).forEach(([hua, sp]) => {
    const pal = (sp.split("→")[1] || "").trim();
    if (pal) (badges[pal] = badges[pal] || []).push(hua);
  });
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(4, 1fr)", gridTemplateRows: "repeat(4, minmax(76px, auto))" }}>
      {c.palaces.map((p: ZiweiPalace) => {
        const pos = POS[p.branch];
        if (!pos) return null;
        const isSoul = p.name === "命宮";
        const isTarget = c.target_palaces.includes(p.name);
        return (
          <div key={p.branch} style={{ gridRow: pos[0], gridColumn: pos[1] }}
            className={`border rounded p-1.5 text-[10px] leading-tight overflow-hidden ${isSoul ? "border-emerald-600 bg-emerald-950/20" : isTarget ? "border-purple-800 bg-purple-950/10" : "border-zinc-800 bg-zinc-950/40"}`}>
            <div className="flex flex-wrap gap-x-1 text-zinc-200">{p.stars.length ? p.stars.map((s, i) => <span key={i}>{s}</span>) : <span className="text-zinc-600">—</span>}</div>
            <div className="flex items-center justify-between mt-1">
              <span className={`${isSoul ? "text-emerald-400" : isTarget ? "text-purple-300" : "text-zinc-500"}`}>{p.name}{p.is_body ? "·身" : ""}</span>
              <span className="text-zinc-600">{p.branch}</span>
            </div>
            {badges[p.name] && <div className="mt-0.5 flex gap-1">{badges[p.name].map((h) => <span key={h} className={HUA_COLOR[h]}>{h}</span>)}</div>}
          </div>
        );
      })}
      <div style={{ gridRow: "2 / span 2", gridColumn: "2 / span 2" }} className="border border-zinc-800 rounded bg-zinc-950/60 p-3 flex flex-col items-center justify-center text-center gap-1">
        <div className="text-xs text-zinc-500">命盤 · 上市 {c.listing_date}{c.listing_date_is_data_limit && <span className="text-amber-400"> (資料起點)</span>}</div>
        <div className="text-sm text-zinc-200">命宮主星 <span className="text-emerald-400">{c.soul_star}</span> · 身宮 {c.body_star}</div>
        <div className="text-xs text-zinc-400">{c.five_elements_class}</div>
        <div className="text-xs text-zinc-400 mt-1">流年 {c.liunian_stem}：{c.liunian_sihua}</div>
      </div>
    </div>
  );
}

export default function ZiweiPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task28Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createZiwei(t); setJob(j); pollZiwei(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  const c = r?.chart;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 28</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">紫微斗數（四化飛星）· CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">以公司<strong>上市日</strong>排紫微命盤（十二宮、十四主星、五行局），
        再以<strong>四化飛星</strong>判運：當年天干的化祿／化權飛入命宮／財帛／官祿則持有，化忌飛入則空手。LLM 寫命書，引擎照樣忽略。
        刻意毫無預測力 —— 正是重點。</p></section>
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
          <div className="border border-zinc-800 rounded-md p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-2">命盤（十二宮 · 命宮綠框、命財官紫框、四化飛星標於落宮）</h3>
            <Board c={c} />
          </div>
          <div className="border border-zinc-800 rounded-md p-4 space-y-2">
            <h3 className="text-sm font-semibold text-zinc-200">推理鏈</h3>
            <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((x, i) => <li key={i}>{x}</li>)}</ol>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">命書 &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.ziwei_readings} labels={RLABEL} regimeKey="ziwei_regime" colors={REGIME} />
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
