"use client";

import { useState } from "react";
import { createCongress, pollCongress, Task22Job, CongressResult, CongressSpec } from "@/lib/api";
import { CandlestickChart, EquityChart } from "./Charts";
import { Backtest, Caveats, Readings } from "../_components/panels";

const STANCE: Record<string, string> = {
  bullish: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-900",
  cautious: "text-amber-400 border-amber-700 bg-amber-950/30",
};
const REGIME: Record<string, string> = {
  net_buying: "text-emerald-400 border-emerald-700 bg-emerald-950/30",
  quiet: "text-zinc-300 border-zinc-700 bg-zinc-900",
  net_selling: "text-amber-400 border-amber-700 bg-amber-950/30",
  no_data: "text-zinc-400 border-zinc-700 bg-zinc-900",
};
const SIG: Record<string, string> = {
  buy_and_hold: "Buy & hold", follow_buys: "Follow disclosed buys", avoid_after_sells: "Avoid after disclosed sells",
};
const RLABEL: Record<string, string> = {
  congress_regime: "Regime", n_trades: "Trades", n_buys: "Buys", n_sells: "Sells",
  net_buy_minus_sell: "Net (buys−sells)", days_since_last_disclosure: "Days since last", provider: "Provider",
};

export default function CongressPage() {
  const [ticker, setTicker] = useState("");
  const [job, setJob] = useState<Task22Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase(); if (!t) return;
    setBusy(true); setErr(null); setJob(null);
    try { const j = await createCongress(t); setJob(j); pollCongress(j.job_id, (n) => { setJob(n); if (n.status !== "pending" && n.status !== "running") setBusy(false); }); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setBusy(false); }
  }
  const r = job?.result ?? null;
  return (
    <div className="space-y-6">
      <section><div className="flex items-baseline gap-2"><h1 className="text-2xl font-semibold">Task 22</h1>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Congressional Trading → Strategy → Backtest</span></div>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-3xl">Enter a ticker. US lawmakers disclose their
        trades under the STOCK Act (up to 45 days late); we key every signal to the <strong>disclosure date</strong>, so the
        edge — if any — is post-disclosure drift, not front-running. A weak, crowded signal. <strong>Data is pluggable</strong>:
        free coverage parses the House Clerk's PTR PDFs best-effort (partial, House-only); set a Quiver/FMP key for full
        House+Senate history.</p></section>
      <form onSubmit={run} className="flex gap-2 max-w-md">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. NVDA"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:border-emerald-700 outline-none" />
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50">{busy ? "Running…" : "Generate"}</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {job && <p className="text-xs text-zinc-500">job <code className="text-zinc-300">{job.job_id}</code> · <code className={job.status === "succeeded" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-zinc-300"}>{job.status}</code>{busy && " · fetching disclosures (free PDF scan can be slow), backtesting…"}</p>}
      {job?.status === "failed" && <p className="text-red-400 text-sm">{job.error_message}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2"><h2 className="text-xl font-semibold">{r.ticker}</h2>
            <span className="text-xs text-zinc-500">as-of {r.as_of_date} · {r.n_trades} trades · {r.provider} · cost ${r.cost_usd.toFixed(4)}</span></div>
          <div className="border border-zinc-800 rounded-md p-3"><h3 className="text-sm font-semibold text-zinc-300 mb-1">Price</h3>
            <CandlestickChart prices={r.prices} trades={r.backtest.trades} filingDate={r.backtest.start_date} markerLabel="window start" /></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-md p-4 space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-zinc-200">Strategy &amp; thesis</h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STANCE[r.strategy.stance] || ""}`}>{r.strategy.stance}</span></div>
              <div className="text-xs text-zinc-400"><span className="text-zinc-200">{SIG[r.strategy.entry_signal] || r.strategy.entry_signal}</span>{r.strategy.entry_signal === "follow_buys" && <span> · hold {r.strategy.holding_days}d</span>}{r.strategy.entry_signal === "avoid_after_sells" && <span> · avoid {r.strategy.sell_window_days}d</span>}{r.strategy.stop_loss_pct > 0 && <span> · stop {r.strategy.stop_loss_pct}%</span>}</div>
              <p className="text-sm text-zinc-300 leading-relaxed">{r.strategy.thesis}</p>{r.strategy.rationale && <p className="text-xs text-zinc-500">{r.strategy.rationale}</p>}</div>
            <Backtest m={r.backtest.metrics} />
          </div>
          <Readings readings={r.congress_readings} labels={RLABEL} regimeKey="congress_regime" colors={REGIME} />
          {r.trades_recent.length > 0 && (
            <div className="border border-zinc-800 rounded-md p-4 overflow-x-auto"><h3 className="text-sm font-semibold text-zinc-200 mb-2">Recent disclosed trades</h3>
              <table className="w-full text-xs"><thead className="text-zinc-500 text-left"><tr><th className="py-1 pr-3">Disclosed</th><th className="pr-3">Chamber</th><th className="pr-3">Type</th><th className="pr-3 text-right">Amount</th><th className="pr-3">Member</th></tr></thead>
                <tbody className="text-zinc-300">{[...r.trades_recent].reverse().map((t, i) => <tr key={i} className="border-t border-zinc-900"><td className="py-1 pr-3 whitespace-nowrap">{t.disclosure_date}</td><td className="pr-3">{t.chamber}</td><td className={`pr-3 ${t.txn_type === "buy" ? "text-emerald-400" : t.txn_type === "sell" ? "text-red-400" : "text-zinc-400"}`}>{t.txn_type}</td><td className="pr-3 text-right">{t.amount_high > 0 ? `$${(t.amount_low/1000).toFixed(0)}k–${(t.amount_high/1000).toFixed(0)}k` : "—"}</td><td className="pr-3 text-zinc-500">{t.member}</td></tr>)}</tbody></table></div>
          )}
          <div className="border border-zinc-800 rounded-md p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-zinc-300">Equity curve</h3>
            <p className="text-xs"><span className="text-emerald-400">━ strategy</span>{"   "}<span className="text-zinc-500">━ buy &amp; hold</span>{"   "}<span className="text-blue-400">┄ S&amp;P 500</span></p></div>
            <EquityChart curve={r.backtest.equity_curve} /></div>
          <Caveats caveats={r.caveats} />
        </div>
      )}
    </div>
  );
}
