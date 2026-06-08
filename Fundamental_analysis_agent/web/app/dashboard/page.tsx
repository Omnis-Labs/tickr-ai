"use client";

import { useEffect, useState } from "react";
import {
  Capabilities,
  CostSummary,
  EvalReport,
  NullBand,
  RecentJob,
  Task2Capabilities,
  getCapabilities,
  getCostSummary,
  getEvalReport,
  getNullBand,
  getRecentJobs,
  getTask2Capabilities,
} from "@/lib/api";
import { Linkify } from "@/lib/format";

const STATUS_COLOR: Record<string, string> = {
  succeeded: "text-emerald-400",
  escalated: "text-orange-400",
  failed: "text-red-400",
  quarantined: "text-yellow-400",
  pending: "text-zinc-400",
  running: "text-cyan-400",
  infra_error: "text-purple-400",
};

const fmtUSD = (v: number, digits = 4) => `$${v.toFixed(digits)}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtMs = (v: number) => `${(v / 1000).toFixed(1)}s`;

function KpiTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
      ? "text-yellow-400"
      : tone === "bad"
      ? "text-red-400"
      : "text-zinc-100";
  return (
    <div className="border border-zinc-800 rounded-md p-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border border-zinc-800 rounded-md">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// Divination-control null band: 11 placebo systems' Sharpes vs the real agents.
function NullBandPanel({ band }: { band: NullBand | null }) {
  if (!band) return <Section title="Divination-control null band" hint="loading…"><p className="text-xs text-zinc-500">…</p></Section>;
  if (!band.available) {
    return <Section title="Divination-control null band" hint="not generated">
      <p className="text-xs text-zinc-500">Run <code>python -m tools.divination_null_band</code>. {band.reason}</p></Section>;
  }
  const lo = -1.0, hi = 2.2;                          // Sharpe axis
  const X = (s: number) => `${((Math.max(lo, Math.min(hi, s)) - lo) / (hi - lo)) * 100}%`;
  const p = band.pooled_sharpe || {};
  const p95 = band.sharpe_p95_threshold ?? p.p95 ?? 0;
  const systems = Object.entries(band.by_system_max_sharpe || {});
  const overlay = Object.entries(band.real_agent_overlay || {});
  const ticks = [
    { k: "p50", v: p.p50, c: "border-zinc-500" }, { k: "p90", v: p.p90, c: "border-zinc-400" },
    { k: "p95", v: p95, c: "border-amber-400" }, { k: "p99", v: p.p99, c: "border-zinc-400" },
    { k: "max", v: p.max, c: "border-red-400" },
  ].filter((t) => typeof t.v === "number");
  return (
    <Section title="Divination-control null band — real agents vs 11 placebo systems"
      hint={`${band.n_draws} draws · ${(band.panel || []).length} names · p95 Sharpe ${p95}`}>
      <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
        11 worthless divination systems run through the identical lookahead-free backtest. The pooled band is the
        Sharpe you get from date-keyed timing + the equity premium. A real agent inside the band is indistinguishable
        from divination. (Raw single-name Sharpe is inflated by the equity premium on whichever names rose — which is
        why the suite scores <span className="text-zinc-300">alpha vs SPY</span>, not raw Sharpe.)
      </p>
      {/* axis */}
      <div className="relative h-36 mb-2">
        {/* shaded band p50→p95 */}
        <div className="absolute top-8 h-3 bg-purple-900/40 border-y border-purple-800"
          style={{ left: X(p.p50 ?? lo), width: `calc(${X(p95)} - ${X(p.p50 ?? lo)})` }} />
        {/* full track */}
        <div className="absolute top-[38px] left-0 right-0 h-px bg-zinc-800" />
        {/* percentile ticks */}
        {ticks.map((t) => (
          <div key={t.k} className="absolute" style={{ left: X(t.v as number), top: "12px" }}>
            <div className={`w-0 h-10 border-l ${t.c}`} />
            <div className="text-[10px] text-zinc-500 -translate-x-1/2 mt-0.5 whitespace-nowrap">{t.k} {(t.v as number).toFixed(2)}</div>
          </div>
        ))}
        {/* real-agent markers — at MEDIAN single-name Sharpe (guard against an older report shape) */}
        {overlay.map(([name, o], i) => {
          const med = typeof o.sharpe_median === "number" ? o.sharpe_median : 0;
          return (
            <div key={name} className="absolute" style={{ left: X(med), top: `${64 + (i % 4) * 17}px` }}>
              <div className={`w-2.5 h-2.5 rounded-full -translate-x-1/2 ${o.clears_control_p95 ? "bg-emerald-400" : "bg-red-400"}`} />
              <div className={`text-[10px] -translate-x-1/2 whitespace-nowrap ${o.clears_control_p95 ? "text-emerald-400" : "text-red-400"}`}>
                {name.split(" ")[0]} {med.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">
        <span className="text-emerald-400">●</span> clears control p95 &nbsp;
        <span className="text-red-400">●</span> inside the band (indistinguishable from a placebo) &nbsp;·&nbsp;
        <span className="text-purple-300">▮</span> p50→p95 control band
      </p>
      {/* per-system max Sharpe bars */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {systems.map(([s, v]) => (
          <div key={s} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 text-zinc-400 truncate">{s}</span>
            <div className="flex-1 h-2 bg-zinc-900 rounded"><div className="h-2 rounded bg-purple-700" style={{ width: `${Math.min(100, (v / 2.0) * 100)}%` }} /></div>
            <span className="w-10 text-right tabular-nums text-zinc-300">{v.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function DashboardPage() {
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [task2Caps, setTask2Caps] = useState<Task2Capabilities | null>(null);
  const [nullBand, setNullBand] = useState<NullBand | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getEvalReport(),
      getCostSummary(),
      getRecentJobs(8),
      getCapabilities(),
      getTask2Capabilities(),
    ])
      .then(([e, c, r, cap, t2cap]) => {
        setEvalReport(e);
        setCost(c);
        setRecent(r);
        setCaps(cap);
        setTask2Caps(t2cap);
      })
      .catch((e) => setErr(String(e)));
    // independent fetch so a missing band never breaks the rest of the dashboard
    getNullBand().then(setNullBand).catch(() => setNullBand({ available: false }));
  }, []);

  if (err) {
    return (
      <div className="text-sm text-red-400">
        Failed to load dashboard data: {err}
        <div className="text-zinc-500 mt-2 text-xs">
          Is the backend running on <code>{process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}</code>?
        </div>
      </div>
    );
  }

  const m = evalReport?.metrics;
  const passTone = m ? (m.pass_rate >= 0.8 ? "good" : m.pass_rate >= 0.5 ? "warn" : "bad") : "default";
  const recoveryTone = m && m.recovery_rate > 0 ? "good" : "warn";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Eval &amp; Cost Dashboard</h1>
        <p className="text-sm text-zinc-400">
          Surfaces the latest eval baseline + all-time cost ledger. Numbers are
          read directly from <code>report.json</code> and Postgres/SQLite, not
          estimated. See <code>docs/VERIFICATION.md</code> for methodology.
        </p>
      </header>

      {/* ---------- KPI tiles ---------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Eval pass rate"
          value={m ? fmtPct(m.pass_rate) : "—"}
          hint={m ? `${m.n_pass}/${m.n_cases} cases` : evalReport?.reason}
          tone={passTone}
        />
        <KpiTile
          label="Recovery rate"
          value={m ? fmtPct(m.recovery_rate) : "—"}
          hint="passed AFTER ≥1 recovery"
          tone={recoveryTone}
        />
        <KpiTile
          label="Cost p50 / p95"
          value={m ? `${fmtUSD(m.cost_p50)} / ${fmtUSD(m.cost_p95)}` : "—"}
          hint="per task, from ledger"
        />
        <KpiTile
          label="Total ledger spend"
          value={cost ? fmtUSD(cost.total_cost_usd, 4) : "—"}
          hint={cost ? `${cost.total_calls} LLM calls all-time` : undefined}
        />
      </div>

      {/* ---------- Divination-control null band ---------- */}
      <NullBandPanel band={nullBand} />

      {/* ---------- Eval cases ---------- */}
      <Section
        title="Eval cases"
        hint={
          evalReport?.generated_at
            ? `Last run: ${new Date(evalReport.generated_at).toLocaleString()}`
            : "No eval run yet"
        }
      >
        {!evalReport?.cases ? (
          <p className="text-xs text-zinc-500">{evalReport?.reason || "Loading…"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-zinc-500 border-b border-zinc-800">
                <tr>
                  <th className="text-left py-2">ID</th>
                  <th className="text-left">Category</th>
                  <th className="text-right">Status</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Dur</th>
                  <th className="text-right">Recovery</th>
                  <th className="text-left pl-4">Failure</th>
                </tr>
              </thead>
              <tbody>
                {evalReport.cases.map((c) => {
                  const inner = (
                    <>
                      <td className="py-1.5 text-zinc-200">
                        {c.passed ? "✅" : "❌"} {c.id}
                        {c.job_id && (
                          <span className="ml-2 text-[10px] text-zinc-600 group-hover:text-blue-400">↗ inspect</span>
                        )}
                      </td>
                      <td className="text-zinc-400">{c.category}</td>
                      <td className={`text-right ${STATUS_COLOR[c.status] || "text-zinc-300"}`}>
                        {c.status}
                      </td>
                      <td className="text-right text-zinc-300">{fmtUSD(c.cost_usd)}</td>
                      <td className="text-right text-zinc-300">{fmtMs(c.duration_ms)}</td>
                      <td className="text-right">
                        {c.recovery_attempts > 0 ? (
                          <span className="text-emerald-400">{c.recovery_attempts}</span>
                        ) : (
                          <span className="text-zinc-600">0</span>
                        )}
                      </td>
                      <td className="pl-4 text-orange-400">{c.failure_reason || ""}</td>
                    </>
                  );
                  return c.job_id ? (
                    <tr
                      key={c.id}
                      className="border-b border-zinc-900 hover:bg-zinc-900/60 cursor-pointer group"
                      onClick={() => (window.location.href = `/jobs/${c.job_id}`)}
                    >
                      {inner}
                    </tr>
                  ) : (
                    <tr key={c.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 group">
                      {inner}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {m?.by_category && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {Object.entries(m.by_category).map(([cat, stats]) => (
              <div key={cat} className="bg-zinc-900/50 border border-zinc-800 rounded px-2 py-1.5">
                <div className="text-zinc-500">{cat}</div>
                <div className="text-zinc-200">
                  pass {fmtPct(stats.pass_rate)} · n={stats.n} · μ {fmtUSD(stats.mean_cost_usd)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---------- Cost breakdown ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Cost by purpose" hint="all-time ledger">
          {!cost ? (
            <p className="text-xs text-zinc-500">Loading…</p>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="text-zinc-500 border-b border-zinc-800">
                <tr>
                  <th className="text-left py-1">Purpose</th>
                  <th className="text-right">Calls</th>
                  <th className="text-right">$</th>
                  <th className="text-right">In tok</th>
                  <th className="text-right">Out tok</th>
                </tr>
              </thead>
              <tbody>
                {cost.by_purpose.map((p) => (
                  <tr key={p.purpose} className="border-b border-zinc-900">
                    <td className="py-1.5 text-zinc-200">{p.purpose}</td>
                    <td className="text-right text-zinc-300">{p.calls}</td>
                    <td className="text-right text-zinc-300">{fmtUSD(p.cost_usd, 4)}</td>
                    <td className="text-right text-zinc-500">{p.input_tokens.toLocaleString()}</td>
                    <td className="text-right text-zinc-500">{p.output_tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Cost by model" hint="tier routing evidence">
          {!cost ? (
            <p className="text-xs text-zinc-500">Loading…</p>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="text-zinc-500 border-b border-zinc-800">
                <tr>
                  <th className="text-left py-1">Backend</th>
                  <th className="text-left">Model</th>
                  <th className="text-right">Calls</th>
                  <th className="text-right">$</th>
                  <th className="text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {cost.by_model.map((m) => (
                  <tr key={`${m.backend}-${m.model}`} className="border-b border-zinc-900">
                    <td className="py-1.5 text-zinc-400">{m.backend}</td>
                    <td className="text-zinc-200">{m.model}</td>
                    <td className="text-right text-zinc-300">{m.calls}</td>
                    <td className="text-right text-zinc-300">{fmtUSD(m.cost_usd, 4)}</td>
                    <td className="text-right text-zinc-500">
                      {cost.total_cost_usd > 0 ? fmtPct(m.cost_usd / cost.total_cost_usd) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {/* ---------- Recent jobs ---------- */}
      <Section title="Recent jobs" hint="in-memory (this process)">
        {recent.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No jobs in this server process yet. Submit one on{" "}
            <a href="/task1" className="underline">/task1</a>.
          </p>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead className="text-zinc-500 border-b border-zinc-800">
              <tr>
                <th className="text-left py-1">Job</th>
                <th className="text-left">Task</th>
                <th className="text-right">Status</th>
                <th className="text-right">Steps</th>
                <th className="text-right">Recovery</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((j) => (
                <tr
                  key={j.job_id}
                  className="border-b border-zinc-900 hover:bg-zinc-900/60 cursor-pointer group"
                  onClick={() => (window.location.href = `/jobs/${j.job_id}`)}
                >
                  <td className="py-1.5 text-zinc-200">
                    {j.job_id.slice(0, 10)}
                    <span className="ml-2 text-[10px] text-zinc-600 group-hover:text-blue-400">↗</span>
                  </td>
                  <td className="text-zinc-400 truncate max-w-[28ch]" title={j.task_description}>
                    {j.task_description}
                  </td>
                  <td className={`text-right ${STATUS_COLOR[j.status] || "text-zinc-300"}`}>
                    {j.status}
                  </td>
                  <td className="text-right text-zinc-300">{j.n_steps}</td>
                  <td className="text-right text-zinc-300">{j.recovery_attempts}</td>
                  <td className="text-right text-zinc-300">{fmtUSD(j.total_cost_usd, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ---------- Task 1 capability matrix ---------- */}
      <h2 id="task1-capabilities" className="text-sm font-semibold text-zinc-300 pt-2">
        Task 1 — Browser Agent capability matrix
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Supported sites" hint={caps ? `${caps.supported_sites.length} entries` : ""}>
          {!caps ? (
            <p className="text-xs text-zinc-500">Loading…</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {caps.supported_sites.map((s, i) => (
                <li key={i} className="border-l-2 border-emerald-700 pl-2">
                  <div className="text-emerald-400 font-semibold">{s.domain}</div>
                  <div className="text-zinc-400">{s.operations?.join(" · ")}</div>
                  {s.notes && <div className="text-zinc-500 italic">{s.notes}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Unsupported / unreliable" hint={caps ? `${caps.unsupported_or_unreliable.length} entries` : ""}>
          {!caps ? (
            <p className="text-xs text-zinc-500">Loading…</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {caps.unsupported_or_unreliable.map((s, i) => (
                <li key={i} className="border-l-2 border-red-700 pl-2">
                  <div className="text-red-400 font-semibold">{s.pattern || s.domain}</div>
                  <div className="text-zinc-500">{s.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* ---------- Task 2 capability matrix ---------- */}
      <h2 id="task2-capabilities" className="text-sm font-semibold text-zinc-300 pt-2">
        Task 2 — 10-K Extractor capability matrix
      </h2>
      {!task2Caps ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* Proven supported filings (concrete URLs from eval baseline) */}
          <Section
            title="Filings where extraction is proven to work"
            hint={`${task2Caps.proven_supported_filings.length} eval-baselined examples`}
          >
            <ul className="space-y-3 text-xs">
              {task2Caps.proven_supported_filings.map((f, i) => (
                <li key={i} className="border-l-2 border-emerald-700 pl-2">
                  <div className="text-emerald-400 font-semibold">{f.label}</div>
                  <div className="text-zinc-500 text-[11px] mt-0.5 flex flex-wrap gap-3">
                    <span>{f.items_extracted} items</span>
                    <span>· conf {(f.overall_confidence * 100).toFixed(1)}%</span>
                    <span>· {f.method_mix}</span>
                    <span>· cost ${f.cost_usd.toFixed(4)}</span>
                    {f.industry && <span>· {f.industry}</span>}
                  </div>
                  <div className="font-mono text-[11px] mt-1 break-all">
                    <Linkify text={f.url} />
                  </div>
                  {f.notes && (
                    <div className="text-zinc-500 italic text-[11px] mt-0.5">{f.notes}</div>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          {/* Known failure cases — specific filings with documented issues */}
          <Section
            title="Known failure cases (with documented root cause + system response)"
            hint={`${task2Caps.known_failure_cases.length} case${task2Caps.known_failure_cases.length === 1 ? "" : "s"}`}
          >
            {task2Caps.known_failure_cases.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No known failure cases in the current eval baseline.
              </p>
            ) : (
              <ul className="space-y-3 text-xs">
                {task2Caps.known_failure_cases.map((f, i) => (
                  <li key={i} className="border-l-2 border-red-700 pl-2">
                    <div className="text-red-400 font-semibold">{f.label}</div>
                    <div className="font-mono text-[11px] mt-1 break-all">
                      <Linkify text={f.url} />
                    </div>
                    <div className="text-zinc-300 mt-1">
                      <span className="text-zinc-500">issue: </span>
                      {f.issue}
                    </div>
                    <div className="text-zinc-400 text-[11px] mt-1">
                      <span className="text-zinc-500">root cause: </span>
                      {f.root_cause}
                    </div>
                    <div className="text-emerald-300/80 text-[11px] mt-1">
                      <span className="text-zinc-500">system response: </span>
                      {f.system_response}
                    </div>
                    {f.fix_direction && (
                      <div className="text-zinc-500 italic text-[11px] mt-1">
                        fix direction: {f.fix_direction}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Format categories — broader buckets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Section title="Format categories supported" hint={`${task2Caps.format_categories.supported.length} bucket${task2Caps.format_categories.supported.length === 1 ? "" : "s"}`}>
              <ul className="space-y-1.5 text-xs">
                {task2Caps.format_categories.supported.map((s, i) => (
                  <li key={i} className="border-l-2 border-emerald-700 pl-2 text-zinc-300">
                    {s}
                  </li>
                ))}
              </ul>
            </Section>
            <Section
              title="Format categories NOT supported"
              hint={`${task2Caps.format_categories.unsupported_or_unreliable.length} pattern${task2Caps.format_categories.unsupported_or_unreliable.length === 1 ? "" : "s"}`}
            >
              <ul className="space-y-2 text-xs">
                {task2Caps.format_categories.unsupported_or_unreliable.map((u, i) => (
                  <li key={i} className="border-l-2 border-red-700 pl-2">
                    <div className="text-red-400 font-semibold">{u.pattern}</div>
                    {u.example && (
                      <div className="text-zinc-500 text-[11px]">e.g. {u.example}</div>
                    )}
                    <div className="text-zinc-400 text-[11px] mt-0.5">
                      {u.system_response}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          {/* Refusal categories — typed refusals at input parse time */}
          <Section
            title="Typed-refusal input categories (parser rejects before any extraction)"
            hint={`${task2Caps.refusal_categories.length} categor${task2Caps.refusal_categories.length === 1 ? "y" : "ies"}`}
          >
            <ul className="space-y-2 text-xs">
              {task2Caps.refusal_categories.map((r, i) => (
                <li key={i} className="border-l-2 border-orange-700 pl-2">
                  <div className="text-orange-400 font-semibold">{r.category}</div>
                  <div className="text-zinc-500 text-[11px] mt-0.5">
                    example input: <code className="text-zinc-300">{r.example_input}</code>
                  </div>
                  <div className="text-zinc-400 text-[11px] mt-0.5">{r.system_response}</div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <footer className="text-xs text-zinc-600 pt-4 border-t border-zinc-900">
        Cache hit rate (all-time): {cost ? fmtPct(cost.cache_hit_rate) : "—"} · Tokens:{" "}
        {cost ? `${cost.total_input_tokens.toLocaleString()} in / ${cost.total_output_tokens.toLocaleString()} out` : "—"}
      </footer>
    </div>
  );
}
