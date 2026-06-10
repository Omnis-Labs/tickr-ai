"use client";

import { useState } from "react";
import { createScan, pollScan, ScanJob, ScanAgentMeta } from "@/lib/api";

const KIND_HEAD: Record<string, string> = { real: "text-emerald-400", market: "text-blue-400", placebo: "text-purple-400" };
const STANCE: Record<string, string> = {
  "傾向做多": "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  "持有 SPY（無訊號）": "text-zinc-300 border-zinc-700 bg-zinc-900",
  "市場 risk-off → 持有 SPY": "text-amber-400 border-amber-700 bg-amber-950/30",
  "資料不足": "text-zinc-500 border-zinc-800 bg-zinc-900",
};

function Cell({ v }: { v: boolean | null | undefined }) {
  if (v === true) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" title="long" />;
  if (v === false) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-700" title="flat" />;
  return <span className="text-zinc-600">—</span>;
}

export default function ScannerPage() {
  const [tickers, setTickers] = useState("AAPL, MSFT, NVDA, GOOGL, META, AMZN");
  const [job, setJob] = useState<ScanJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPlacebo, setShowPlacebo] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const list = tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!list.length) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const j = await createScan(list);
      setJob(j);
      pollScan(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); });
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }

  const r = job?.result ?? null;
  const agents: ScanAgentMeta[] = (r?.agents ?? []).filter((a) => showPlacebo || a.kind !== "placebo");
  const tiltLong = (r?.rows ?? []).filter((x) => x.stance === "傾向做多").map((x) => x.ticker);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Scanner</h1>
          <span className="text-xs text-zinc-400 uppercase tracking-wider">選股 + 多 agent 協作</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          一次掃整個觀察清單：看每檔股票<strong>今天有哪些 agent 給出做多訊號</strong>（選股），再由真 agent 投票出一個立場（協作）。
          <strong>沒有 agent 有把握時，預設持有 SPY</strong>——你不必一個一個 agent 去試。對照組（占卜）只是參照：它們也會亮，提醒你別只信單一綠點。
        </p>
      </section>

      <form onSubmit={run} className="flex gap-2 max-w-2xl">
        <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="AAPL, MSFT, NVDA…"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "掃描中…" : "掃描今日訊號"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && job.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {busy && <p className="text-xs text-zinc-500">跑每檔的每個 agent 今日訊號（含 SEC 抓取，可能需 30–60s）…</p>}

      {r && (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-zinc-500">as-of {r.as_of} · {r.n_tickers} 檔 · 綠＝做多訊號、灰＝無訊號、—＝資料不足</p>
            <label className="text-xs text-zinc-400 flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showPlacebo} onChange={(e) => setShowPlacebo(e.target.checked)} /> 顯示對照組（占卜）
            </label>
          </div>

          <div className="border border-zinc-800 rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-zinc-500 border-b border-zinc-800">
                <th className="py-2 px-3">標的</th>
                {agents.map((a) => <th key={a.key} className={`px-2 text-center text-[11px] ${KIND_HEAD[a.kind]}`} title={a.label}>{a.key}</th>)}
                <th className="px-3">真 agent 投票</th>
                <th className="px-3">今日立場</th>
              </tr></thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.ticker} className="border-b border-zinc-900">
                    <td className="py-2 px-3 font-medium text-zinc-200">{row.ticker}</td>
                    {agents.map((a) => <td key={a.key} className="px-2 text-center"><Cell v={row.signals[a.key]} /></td>)}
                    <td className="px-3 text-xs text-zinc-400 tabular-nums">{row.real_bull}/{row.real_total} 做多</td>
                    <td className="px-3"><span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[row.stance] || "border-zinc-800 text-zinc-400"}`}>{row.stance}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-zinc-800 rounded-md p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-1">今日的「書」（建議組合）</h3>
            {tiltLong.length ? (
              <p className="text-sm text-zinc-300">傾向做多：{tiltLong.map((t) => <span key={t} className="text-emerald-400 font-medium mr-2">{t}</span>)}<span className="text-zinc-500">· 其餘資金 → 持有 SPY（市場地板）</span></p>
            ) : (
              <p className="text-sm text-zinc-400">今天沒有名字有足夠把握 → <span className="text-zinc-200">全部持有 SPY</span>（first do no harm）。</p>
            )}
            <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
              真 agent＝T19 價格異常、T17 基本面品質（綠/灰）；T20 為市場波動門（risk-off 時整體減碼）。對照組（占卜）若也亮，正說明「單一綠點不代表有 alpha」——
              真正的把握要過顯著性門檻（DSR/虛無帶，見 dashboard）。沒訊號就持有大盤，是這套系統的預設安全網。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
