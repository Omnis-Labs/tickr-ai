"use client";

// Shared result panels reused by the price/readings agents (Tasks 14/15/16).
import { BacktestMetrics } from "@/lib/api";

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function Readings({ readings, labels, regimeKey, colors }: {
  readings: Record<string, number | string>;
  labels: Record<string, string>;
  regimeKey: string;
  colors: Record<string, string>;
}) {
  const regime = readings[regimeKey];
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Readings (as-of)</h3>
        {typeof regime === "string" && (
          <span className={`text-[11px] px-2 py-0.5 rounded border ${colors[regime] || "border-zinc-700 bg-zinc-900 text-zinc-300"}`}>
            {regime.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-3 gap-x-2">
        {Object.keys(labels).filter((k) => k in readings && k !== regimeKey).map((k) => {
          const v = readings[k];
          const isPct = typeof v === "number" && k.endsWith("_pct") && !k.includes("percentile");
          const shown = isPct ? pct(v as number) : String(v);
          return (
            <div key={k}>
              <div className="text-[11px] text-zinc-500">{labels[k]}</div>
              <div className="text-sm font-medium text-zinc-200">{shown}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const color = good == null ? "text-zinc-200" : good ? "text-emerald-400" : "text-red-400";
  return <div><div className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</div><div className={`text-lg font-semibold ${color}`}>{value}</div></div>;
}

export function Backtest({ m }: { m: BacktestMetrics }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">Backtest <span className="text-xs text-zinc-500 font-normal">({m.days} days, {m.transaction_cost_bps} bps/side)</span></h3>
      <div className="grid grid-cols-3 gap-y-3 gap-x-2 mb-3">
        <Metric label="Strategy" value={pct(m.total_return_pct)} good={m.total_return_pct >= 0} />
        <Metric label="Hold · full" value={pct(m.benchmark_return_pct)} />
        <Metric label="Excess" value={pct(m.excess_return_pct)} good={m.excess_return_pct >= 0} />
        {m.market_return_pct != null && (<><div /><Metric label="S&P 500" value={pct(m.market_return_pct)} /><Metric label="Alpha vs mkt" value={pct(m.excess_vs_market_pct as number)} good={(m.excess_vs_market_pct as number) >= 0} /></>)}
      </div>
      <div className="grid grid-cols-3 gap-y-4 gap-x-2 border-t border-zinc-800 pt-3">
        <Metric label="CAGR" value={pct(m.cagr_pct)} good={m.cagr_pct >= 0} />
        <Metric label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe >= 1} />
        <Metric label="Max DD" value={pct(m.max_drawdown_pct)} good={false} />
        <Metric label="Win rate" value={`${m.win_rate_pct.toFixed(0)}%`} />
        <Metric label="Trades" value={String(m.n_trades)} />
        <Metric label="Exposure" value={`${m.exposure_pct.toFixed(0)}%`} />
      </div>
    </div>
  );
}

export function Caveats({ caveats }: { caveats: string[] }) {
  return (
    <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950/40">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Honesty &amp; limitations</h3>
      <ul className="text-xs text-zinc-500 space-y-1 list-disc pl-4">{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
    </div>
  );
}
