"use client";

import { useState } from "react";
import { createMeihua, pollMeihua, Task26Job, MeihuaResult } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  auspicious: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  inauspicious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", ti_yong_auspicious: "Hold when 體用 auspicious", yang_ti: "Hold when 體卦 is yang",
};
const RLABEL: Record<string, string> = {
  gua_regime: "Verdict", ben_gua: "本卦", bian_gua: "變卦", ti_yong: "體 / 用", relation: "生剋", verdict: "斷",
};

function ControlBanner() {
  return (
    <div className="border border-purple-800 bg-purple-950/30 rounded-md p-3 text-xs text-purple-200 leading-relaxed">
      <strong>⚠️ Control / placebo agent — no economic mechanism.</strong> 梅花易數 casts a hexagram from the
      calendar date and runs the <em>identical</em> lookahead-free backtest as the real agents — to calibrate the
      suite&apos;s false-positive rate. It is also the engine behind the <strong>null distribution</strong> (run N
      seeds → a null Sharpe band the real agents are measured against). A confident 卦辭 cannot move a deterministic
      execution: the ultimate test of selection ≠ execution.
    </div>
  );
}

export default function MeihuaPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task26Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createMeihua(t); setJob(j); pollMeihua(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  const h = r?.hexagram;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 26</h1>
        <span className="text-xs text-purple-400 uppercase tracking-wider">梅花易數 Plum-Blossom I Ching · CONTROL</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">A hexagram cast deterministically from the
        date drives a 體用五行生剋 hold/flat rule. The LLM writes the 卦辭; the engine ignores it. Worthless by design —
        which is exactly the point.</p></section>
      <ControlBanner />
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-purple-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-purple-800 hover:bg-purple-700 disabled:opacity-50">{busy ? "起卦中…" : "起卦"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code></p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && h && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker} <span className="text-[11px] px-2 py-0.5 rounded border border-purple-700 bg-purple-950/30 text-purple-300 align-middle">PLACEBO</span></h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">命盤 — {h.ben_gua}</h3>
              <pre className="text-amber-300/90 text-sm leading-relaxed font-mono">{h.line_diagram.join("\n")}</pre>
              <div className="text-xs text-zinc-400 space-y-0.5 pt-1">
                <div>上卦 {h.upper} · 下卦 {h.lower} · 動爻 第{h.moving_line}爻</div>
                <div>互卦 {h.hu_gua} · 變卦 {h.bian_gua}</div>
                <div>體 {h.ti}（{h.ti_wuxing}） / 用 {h.yong}（{h.yong_wuxing}）</div>
                <div>生剋：{h.relation} → <span className={h.auspicious ? "text-emerald-400" : "text-amber-400"}>{h.verdict}</span></div>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">推理鏈</h3>
              <ol className="text-xs text-zinc-400 space-y-1 list-decimal pl-4">{r.reasoning_chain.map((c, i) => <li key={i}>{c}</li>)}</ol>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">卦辭 &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span></div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.meihua_readings} labels={RLABEL} regimeKey="gua_regime" colors={REGIME} />
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
