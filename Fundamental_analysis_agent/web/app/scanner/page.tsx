"use client";

import { useState } from "react";
import { createScan, pollScan, ScanJob, ScanAgentMeta, ScanRow,
  createBookBacktest, pollBookBacktest, BookJob, ScanCurvePoint } from "@/lib/api";

function EquityMini({ curve }: { curve: ScanCurvePoint[] }) {
  if (curve.length < 2) return null;
  const W = 640, H = 160, P = 8;
  const vals = curve.flatMap((c) => [c.book, c.spy, c.hold]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => P + (i / (curve.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = (key: "book" | "spy" | "hold") => curve.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(c[key]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="book vs SPY vs hold equity">
      <rect width={W} height={H} fill="#0a0a0b" />
      <line x1={P} y1={y(1)} x2={W - P} y2={y(1)} stroke="#27272a" strokeDasharray="3 3" />
      <path d={path("hold")} fill="none" stroke="#60a5fa" strokeWidth={1.4} strokeDasharray="4 3" />
      <path d={path("spy")} fill="none" stroke="#71717a" strokeWidth={1.5} />
      <path d={path("book")} fill="none" stroke="#34d399" strokeWidth={2} />
    </svg>
  );
}

const TIER_LABEL: Record<string, string> = { cleared: "DSR✓", credible: "PSR>0", weak: "弱", na: "n/a" };
const TIER_HEAD: Record<string, string> = {
  cleared: "text-emerald-400", credible: "text-emerald-300", weak: "text-amber-400", na: "text-zinc-500",
};
const STANCE: Record<string, string> = {
  "傾向做多": "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  "持有 SPY（無訊號）": "text-zinc-300 border-zinc-700 bg-zinc-900",
  "市場 risk-off → 持有 SPY": "text-amber-400 border-amber-700 bg-amber-950/30",
  "資料不足": "text-zinc-500 border-zinc-800 bg-zinc-900",
};

// dot colour by the AGENT's DSR tier (a green dot now means "credible signal", not just "fired")
function Dot({ on, kind, tier, dim }: { on: boolean | null | undefined; kind: string; tier: string; dim: boolean }) {
  if (on === null || on === undefined) return <span className="text-zinc-600">—</span>;
  if (!on) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-700" title="flat" />;
  if (dim) return <span className="inline-block w-2.5 h-2.5 rounded-full border border-zinc-600" title="long (DSR 未過 → 不計)" />;
  const c = kind === "placebo" ? "bg-purple-500"
    : tier === "cleared" ? "bg-emerald-400 ring-2 ring-emerald-400/40"
    : tier === "credible" ? "bg-emerald-500"
    : "bg-amber-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${c}`} title={`long · ${tier}`} />;
}

export default function ScannerPage() {
  const [tickers, setTickers] = useState("AAPL, MSFT, NVDA, GOOGL, META, AMZN");
  const [job, setJob] = useState<ScanJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPlacebo, setShowPlacebo] = useState(false);
  const [dsrOnly, setDsrOnly] = useState(false);   // count only DSR-cleared agents
  const [bt, setBt] = useState<BookJob | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const [deployed, setDeployed] = useState(false);

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
  const tierOf: Record<string, string> = Object.fromEntries((r?.agents ?? []).map((a) => [a.key, a.tier]));
  const agents: ScanAgentMeta[] = (r?.agents ?? []).filter((a) => showPlacebo || a.kind !== "placebo");

  // recompute stance client-side when the DSR-cleared filter is toggled
  function stanceOf(row: ScanRow): string {
    if (row.error || row.real_total === 0) return "資料不足";
    if (row.market_on === false) return "市場 risk-off → 持有 SPY";
    if (dsrOnly) return row.cleared_bull >= 1 ? "傾向做多" : "持有 SPY（無訊號）";
    return row.stance;
  }
  const tilt = (r?.rows ?? []).filter((x) => stanceOf(x) === "傾向做多").map((x) => x.ticker);

  async function backtestBook() {
    if (!tilt.length) return;
    setBtBusy(true); setBt(null); setDeployed(false);
    try {
      const j = await createBookBacktest(tilt);
      setBt(j);
      pollBookBacktest(j.job_id, (n) => { setBt(n); if (n.status !== "pending" && n.status !== "running") setBtBusy(false); });
    } catch { setBtBusy(false); }
  }
  const m = bt?.result?.metrics;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Scanner</h1>
          <span className="text-xs text-zinc-400 uppercase tracking-wider">選股 + 多 agent 協作 + DSR 濾鏡</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">
          一次掃清單：每檔股票<strong>今天有哪些 agent 給做多訊號</strong>（選股），真 agent 投票出立場（協作），<strong>沒把握就預設持有 SPY</strong>。
          綠點的顏色＝該 agent 的 <strong>DSR 可信度層級</strong>——綠點不只代表「有訊號」，而是「<em>可信</em>的訊號」。
        </p>
      </section>

      <form onSubmit={run} className="flex gap-2 max-w-2xl">
        <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="AAPL, MSFT, NVDA…"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "掃描中…" : "掃描今日訊號"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && job.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {busy && <p className="text-xs text-zinc-500">跑每檔的每個 agent 今日訊號（含 SEC / 國會 / 事件抓取，並行，約 30–90s）…</p>}

      {r && (
        <div className="space-y-5">
          {r.n_dsr_cleared === 0 && (
            <div className="border border-amber-800 bg-amber-950/20 rounded-md p-3 text-xs text-amber-200 leading-relaxed">
              ⚠️ 目前 <strong>0 個 agent 通過 DSR&gt;0.95</strong>（多重檢定後與「最佳運氣」無法區別）。預設立場用 <strong>PSR&gt;0 可信</strong>的 agent
              （T19/T17/T18）投票；打開「只算 DSR 過關」會切到嚴格門檻——今天會<strong>全部退回持有 SPY</strong>，這正是這套系統誠實的現況。
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-zinc-500">as-of {r.as_of} · {r.n_tickers} 檔 · 點 = 今日做多訊號，顏色＝agent DSR 層級</p>
            <div className="flex items-center gap-4">
              <label className="text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={dsrOnly} onChange={(e) => setDsrOnly(e.target.checked)} /> 只算 DSR 過關
              </label>
              <label className="text-xs text-zinc-400 flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showPlacebo} onChange={(e) => setShowPlacebo(e.target.checked)} /> 顯示對照組
              </label>
            </div>
          </div>

          <div className="border border-zinc-800 rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-zinc-500 border-b border-zinc-800">
                <th className="py-2 px-3">標的</th>
                {agents.map((a) => (
                  <th key={a.key} className="px-2 text-center" title={`${a.label} · DSR ${a.dsr ?? "n/a"}`}>
                    <div className={`text-[11px] ${a.kind === "placebo" ? "text-purple-400" : TIER_HEAD[a.tier]}`}>{a.key}</div>
                    <div className="text-[9px] text-zinc-600">{a.kind === "placebo" ? "對照" : TIER_LABEL[a.tier]}</div>
                  </th>
                ))}
                <th className="px-3">投票</th>
                <th className="px-3">今日立場</th>
              </tr></thead>
              <tbody>
                {r.rows.map((row) => {
                  const st = stanceOf(row);
                  return (
                    <tr key={row.ticker} className="border-b border-zinc-900">
                      <td className="py-2 px-3 font-medium text-zinc-200">{row.ticker}</td>
                      {agents.map((a) => (
                        <td key={a.key} className="px-2 text-center">
                          <Dot on={row.signals[a.key]} kind={a.kind} tier={a.tier}
                               dim={dsrOnly && a.kind === "real" && tierOf[a.key] !== "cleared"} />
                        </td>
                      ))}
                      <td className="px-3 text-xs text-zinc-400 tabular-nums">{dsrOnly ? `${row.cleared_bull} DSR` : `${row.credible_bull}/${row.credible_total}`}</td>
                      <td className="px-3"><span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[st] || "border-zinc-800 text-zinc-400"}`}>{st}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border border-zinc-800 rounded-md p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-1">今日的「書」（建議組合）{dsrOnly && <span className="text-amber-400 text-xs ml-1">· DSR 過關濾鏡</span>}</h3>
            {tilt.length ? (
              <p className="text-sm text-zinc-300">傾向做多：{tilt.map((t) => <span key={t} className="text-emerald-400 font-medium mr-2">{t}</span>)}<span className="text-zinc-500">· 其餘資金 → 持有 SPY（市場地板）</span></p>
            ) : (
              <p className="text-sm text-zinc-400">{dsrOnly ? "沒有 DSR 過關的 agent 給訊號 → " : "今天沒有名字有足夠把握 → "}<span className="text-zinc-200">全部持有 SPY</span>（first do no harm）。</p>
            )}

            {tilt.length > 0 && (
              <div className="flex items-center gap-2 mt-3">
                <button onClick={backtestBook} disabled={btBusy}
                  className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{btBusy ? "回測中…" : "回測今日的書（近3年）"}</button>
                <button onClick={() => setDeployed(true)}
                  className="px-3 py-1.5 text-xs rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">部署（paper）</button>
                {deployed && <span className="text-[11px] text-amber-400">已存為 paper 組合 · 實盤需接券商（尚未啟用）</span>}
              </div>
            )}
            {bt?.status === "failed" && <p className="text-red-400 text-xs mt-2">{bt.error_message}</p>}
            {m && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <p className="text-xs text-zinc-400 mb-2">回測：持有這些名字（僅在其可信 agent 當日有訊號時），其餘時間持有 SPY，等權、近 3 年、無未來函數。
                  <span className="text-zinc-500"> 在個股時間 {m.avg_in_name_pct}%。</span></p>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs mb-2">
                  <div><div className="text-zinc-500">書（idle=SPY）</div><div className={m.book_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}>{m.book_return_pct}%</div></div>
                  <div><div className="text-zinc-500">抱整籃個股</div><div className="text-blue-400">{m.hold_return_pct}%</div></div>
                  <div><div className="text-zinc-500">SPY</div><div className="text-zinc-300">{m.spy_return_pct}%</div></div>
                  <div><div className="text-zinc-500">書贏 SPY</div><div className={m.alpha_pp >= 0 ? "text-emerald-400" : "text-amber-400"}>{m.alpha_pp >= 0 ? "+" : ""}{m.alpha_pp}pp</div></div>
                  <div><div className="text-zinc-500">Sharpe</div><div className="text-zinc-300">{m.sharpe}</div></div>
                  <div><div className="text-zinc-500">最大回撤</div><div className="text-zinc-300">{m.max_dd_pct}%</div></div>
                </div>
                <EquityMini curve={bt!.result!.curve} />
                <p className="text-[10px] text-zinc-500 mt-1"><span className="text-emerald-400">━ 書（idle=SPY）</span>　<span className="text-blue-400">┄ 抱整籃個股</span>　<span className="text-zinc-500">━ SPY</span>　· 三條線一起看：擇時版（書）通常介於「整籃個股」與 SPY 之間——壓低回撤、讓掉部分上檔，不是保證 alpha。</p>
              </div>
            )}
            <div className="text-[11px] text-zinc-500 mt-3 leading-relaxed space-y-1">
              <p><span className="text-emerald-400">●</span> DSR✓（通過多重檢定，全可信）　<span className="text-emerald-500">●</span> PSR&gt;0（Sharpe 可信、未過 DSR）　<span className="text-amber-500">●</span> 弱　<span className="text-purple-500">●</span> 對照組（占卜，理應無意義）</p>
              <p>真 agent＝T19 價格異常、T17 品質、T18 事件、T11 基本面趨勢、T15 庫藏股、T6 內部人、T22 國會；T20 為市場波動門。
                T11/T15/T6 無乾淨 want_long → 用「跑回測讀最後持倉」推今日訊號，且尚未做顯著性檢定（n/a 層）→ <strong>顯示但不投票</strong>。
                預設投票只算 PSR&gt;0 以上（T19/T17/T18）；T22 是「弱」層、n/a 不計入。把「只算 DSR 過關」打開＝最嚴格的測謊機。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
