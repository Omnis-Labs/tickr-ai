"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ExtractedItem,
  JobInspectorPayload,
  StepResult,
  Task1InspectorPayload,
  Task2InspectorPayload,
  artifactUrl,
  getJobInspector,
} from "@/lib/api";
import { Linkify, fmtUSD, fmtDuration } from "@/lib/format";

const STATE_COLOR: Record<string, string> = {
  PLAN: "text-blue-400",
  LOCATE: "text-cyan-400",
  ACT: "text-emerald-400",
  VERIFY: "text-yellow-400",
  DIAGNOSE: "text-orange-400",
  DONE: "text-emerald-500",
  ESCALATE: "text-red-400",
};

const STATUS_COLOR: Record<string, string> = {
  succeeded: "text-emerald-400",
  escalated: "text-orange-400",
  failed: "text-red-400",
  quarantined: "text-yellow-400",
  running: "text-cyan-400",
  pending: "text-zinc-400",
};

function StepCard({ step }: { step: StepResult }) {
  const [open, setOpen] = useState(!step.success);  // failed steps open by default
  return (
    <div
      className={`border rounded-md ${
        step.success
          ? "border-zinc-800 bg-zinc-900/30"
          : "border-red-900/60 bg-red-950/20"
      }`}
    >
      <button
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-xs"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-8 text-zinc-500 font-mono">#{step.step_index}</span>
        <span className={`font-mono w-20 ${STATE_COLOR[step.state] || "text-zinc-300"}`}>
          {step.state}
        </span>
        <span className="flex-1 text-zinc-200 truncate">
          {step.success ? "✅ passed" : `❌ ${step.failure_kind || "fail"}: ${step.error_message?.slice(0, 90) || ""}`}
        </span>
        <span className="text-zinc-500 font-mono">{(step.duration_ms / 1000).toFixed(1)}s</span>
        <span className="text-zinc-600 font-mono">${step.cost_usd.toFixed(4)}</span>
        <span className="text-zinc-600 w-4 text-center">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-zinc-800/50 grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Screenshot</div>
            {step.screenshot_ref ? (
              <a href={artifactUrl(step.screenshot_ref.key)} target="_blank" rel="noopener">
                <img
                  src={artifactUrl(step.screenshot_ref.key)}
                  alt={`step ${step.step_index} screenshot`}
                  className="border border-zinc-800 rounded max-w-full"
                />
              </a>
            ) : (
              <p className="text-zinc-600 text-xs">no screenshot</p>
            )}
            {step.screenshot_ref && (
              <p className="text-zinc-600 text-[10px] mt-1 font-mono">
                {(step.screenshot_ref.size_bytes / 1024).toFixed(0)} KB · {step.screenshot_ref.key}
              </p>
            )}
          </div>
          <div className="text-xs text-zinc-300 space-y-2">
            {step.error_message && (
              <div>
                <div className="text-zinc-500">Error message</div>
                <div className="text-red-300 font-mono whitespace-pre-wrap">{step.error_message}</div>
              </div>
            )}
            {step.failure_kind && (
              <div>
                <div className="text-zinc-500">Failure kind</div>
                <code className="text-orange-300">{step.failure_kind}</code>
              </div>
            )}
            {step.dom_snapshot_ref && (
              <div>
                <div className="text-zinc-500">DOM snapshot</div>
                <a
                  href={artifactUrl(step.dom_snapshot_ref.key)}
                  target="_blank"
                  rel="noopener"
                  className="text-blue-400 underline font-mono"
                >
                  open {step.dom_snapshot_ref.key.split("/")[1]} ({(step.dom_snapshot_ref.size_bytes / 1024).toFixed(0)} KB)
                </a>
              </div>
            )}
            <div className="text-zinc-500 text-[10px] font-mono pt-1">
              {step.started_at?.slice(11, 19)} → {step.ended_at?.slice(11, 19)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function confidenceTone(c: number): string {
  if (c >= 0.8) return "text-emerald-400";
  if (c >= 0.5) return "text-yellow-400";
  return "text-red-400";
}

function confidenceBg(c: number): string {
  if (c >= 0.8) return "bg-emerald-950/30 border-emerald-800/40";
  if (c >= 0.5) return "bg-yellow-950/30 border-yellow-800/40";
  return "bg-red-950/30 border-red-800/40";
}

function methodBadgeClasses(method: string): string {
  if (method === "L1") return "bg-emerald-900/40 text-emerald-300 border-emerald-700/50";
  if (method === "L2") return "bg-blue-900/40 text-blue-300 border-blue-700/50";
  if (method === "L3") return "bg-purple-900/40 text-purple-300 border-purple-700/50";
  return "bg-zinc-800 text-zinc-400 border-zinc-700";
}

function ExtractedItemRow({ item }: { item: ExtractedItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-md ${confidenceBg(item.confidence)}`}>
      <button
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-xs hover:bg-white/5"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-zinc-100 font-mono font-semibold w-16 shrink-0">
          Item {item.item_id}
        </span>
        <span className="flex-1 text-zinc-300 truncate">{item.title}</span>
        <span className={`font-mono font-semibold ${confidenceTone(item.confidence)}`}>
          {(item.confidence * 100).toFixed(0)}%
        </span>
        <span className="text-zinc-500 font-mono w-20 text-right shrink-0">
          {item.char_length.toLocaleString()} ch
        </span>
        <span className={`text-[10px] font-mono uppercase border px-1.5 py-0.5 rounded ${methodBadgeClasses(item.extraction_method)}`}>
          {item.extraction_method}
        </span>
        <span className="text-zinc-600 w-4 text-center">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-zinc-300 border-t border-zinc-800/50 pt-3 space-y-2">
          {item.notes && (
            <div className="text-orange-400 font-mono">note: {item.notes}</div>
          )}
          <div className="text-zinc-500 font-mono text-[10px]">
            offset {item.start_offset.toLocaleString()} … {item.end_offset.toLocaleString()}
          </div>
          <div className="max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed text-zinc-200">
            <Linkify text={item.content.slice(0, 5000)} />
            {item.content.length > 5000 && (
              <div className="text-zinc-600 mt-2">
                … (truncated; {(item.char_length - 5000).toLocaleString()} more chars)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Task1View({ data }: { data: Task1InspectorPayload }) {
  const job = data.job;
  const meta = data.eval_metadata;
  const statusClass = STATUS_COLOR[job.status] || "text-zinc-300";
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">
          Task 1 Job — Browser Agent
        </h1>
        <div className="text-xs text-zinc-500 mt-1 font-mono space-x-3">
          <span>job <span className="text-zinc-300">{job.job_id}</span></span>
          <span>·</span>
          <span>source: <code className="text-zinc-400">{data.source}</code></span>
          <span>·</span>
          <span>status: <span className={statusClass}>{job.status}</span></span>
          <span>·</span>
          <span>steps: {job.steps.length}</span>
          <span>·</span>
          <span>recovery: {job.recovery_attempts}</span>
          <span>·</span>
          <span>cost: {fmtUSD(job.total_cost_usd)}</span>
        </div>
      </header>

      {meta && (
        <section className={`border rounded-md p-3 ${meta.passed ? "border-emerald-800/50 bg-emerald-950/20" : "border-red-800/50 bg-red-950/20"}`}>
          <div className="flex items-baseline gap-3 mb-2">
            <span className={`text-sm font-semibold ${meta.passed ? "text-emerald-300" : "text-red-300"}`}>
              {meta.passed ? "✅ eval pass" : "❌ eval fail"}
            </span>
            <code className="text-xs text-zinc-300">case: {meta.case_id}</code>
          </div>
          {meta.failure_reason && (
            <div className="text-xs text-red-300 font-mono mb-2">→ {meta.failure_reason}</div>
          )}
          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer">Assertions</summary>
            <pre className="text-zinc-300 mt-2 whitespace-pre-wrap">
              {JSON.stringify(meta.assertions, null, 2)}
            </pre>
          </details>
          {meta.fault_inject && (
            <details className="text-xs mt-2">
              <summary className="text-zinc-500 cursor-pointer">
                Fault injection {meta.fault_status && "(triggered: " + (meta.fault_status as { triggered_count?: number }).triggered_count + "x)"}
              </summary>
              <pre className="text-zinc-300 mt-2 whitespace-pre-wrap">
                {JSON.stringify({ inject: meta.fault_inject, status: meta.fault_status }, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}

      <section className="border border-zinc-800 rounded-md p-3 space-y-2">
        <div>
          <div className="text-xs text-zinc-500 uppercase">Task</div>
          <p className="text-sm text-zinc-200 mt-1">{job.task_description}</p>
        </div>
        {job.target_url && (
          <div>
            <div className="text-xs text-zinc-500 uppercase">Target URL (planner)</div>
            <a href={job.target_url} target="_blank" rel="noopener" className="text-xs text-blue-400 underline font-mono break-all">
              {job.target_url}
            </a>
          </div>
        )}
        <details>
          <summary className="text-xs text-zinc-500 cursor-pointer mt-2">Plan ({job.plan.length} steps)</summary>
          <ol className="text-xs font-mono mt-2 space-y-1">
            {job.plan.map((p) => (
              <li key={p.index} className="text-zinc-300">
                <span className="text-zinc-500">{p.index}.</span>{" "}
                <span className="text-cyan-400">{p.action}</span> → {p.target_description}
                {p.value && <span className="text-zinc-500"> [value: {String(p.value).slice(0, 50)}]</span>}
                <div className="text-zinc-500 pl-5">criteria: {p.success_criteria}</div>
              </li>
            ))}
          </ol>
        </details>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Step trace</h2>
        {job.steps.length === 0 ? (
          <p className="text-xs text-zinc-500">No step results recorded.</p>
        ) : (
          job.steps.map((s: StepResult, i: number) => <StepCard key={i} step={s} />)
        )}
      </section>

      {job.final_output && (
        <section className="border border-emerald-800/40 bg-emerald-950/20 rounded-md p-3">
          <div className="text-xs text-emerald-400 uppercase mb-1">Final output</div>
          <pre className="text-xs text-zinc-200 whitespace-pre-wrap font-mono">
            {JSON.stringify(job.final_output, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

function Task2View({ data }: { data: Task2InspectorPayload }) {
  const job = data.job;
  const ext = job.extraction;
  const statusClass = STATUS_COLOR[job.status] || "text-zinc-300";
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">
          Task 2 Job — 10-K Extractor
        </h1>
        <div className="text-xs text-zinc-500 mt-1 font-mono space-x-3">
          <span>job <span className="text-zinc-300">{job.job_id}</span></span>
          <span>·</span>
          <span>status: <span className={statusClass}>{job.status}</span></span>
          {ext && (
            <>
              <span>·</span>
              <span>items: {ext.items.length}</span>
              <span>·</span>
              <span>cost: {fmtUSD(ext.cost_usd)}</span>
              <span>·</span>
              <span>duration: {fmtDuration(ext.duration_ms)}</span>
            </>
          )}
        </div>
      </header>

      <section className="border border-zinc-800 rounded-md p-3 text-xs space-y-2">
        <div>
          <div className="text-zinc-500 uppercase mb-1">Source filing</div>
          <Linkify text={job.source_url} className="font-mono break-all" />
        </div>
        {job.error_message && (
          <div className="text-red-400 font-mono">crash: {job.error_message}</div>
        )}
      </section>

      {ext && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Coverage</div>
              <div className="text-xl font-semibold text-zinc-100 mt-0.5">
                {ext.n_found_items} / {ext.n_expected_items}
              </div>
              <div className="text-[10px] text-zinc-500">
                {(ext.coverage_ratio * 100).toFixed(0)}% required
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Confidence</div>
              <div className={`text-xl font-semibold mt-0.5 ${confidenceTone(ext.overall_confidence)}`}>
                {(ext.overall_confidence * 100).toFixed(1)}%
              </div>
              <div className="text-[10px]">
                {ext.quarantined ? (
                  <span className="text-red-400">quarantined</span>
                ) : (
                  <span className="text-emerald-400">released</span>
                )}
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Method mix</div>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${methodBadgeClasses("L1")}`}>L1 {ext.extraction_method_summary.L1 || 0}</span>
                <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${methodBadgeClasses("L2")}`}>L2 {ext.extraction_method_summary.L2 || 0}</span>
                <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${methodBadgeClasses("L3")}`}>L3 {ext.extraction_method_summary.L3 || 0}</span>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Cost</div>
              <div className="text-xl font-semibold text-zinc-100 mt-0.5">{fmtUSD(ext.cost_usd)}</div>
              <div className="text-[10px] text-zinc-500">{fmtDuration(ext.duration_ms)}</div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3 col-span-2 md:col-span-1">
              <div className="text-xs text-zinc-500 uppercase">Filing</div>
              <div className="text-[11px] font-mono text-zinc-200 mt-1">CIK {ext.filing.cik || "—"}</div>
              <div className="text-[11px] font-mono text-zinc-500 truncate">
                {ext.filing.accession_number || "—"}
              </div>
            </div>
          </section>

          {ext.quarantine_reasons.length > 0 && (
            <section className={`border rounded-md p-3 text-xs ${ext.quarantined ? "border-red-800/60 bg-red-950/30" : "border-yellow-800/60 bg-yellow-950/20"}`}>
              <div className={`font-semibold mb-1 ${ext.quarantined ? "text-red-300" : "text-yellow-300"}`}>
                {ext.quarantined ? "QUARANTINED" : "Soft warnings"}
              </div>
              <ul className="space-y-0.5 list-disc list-inside text-zinc-300">
                {ext.quarantine_reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-1.5">
            <h2 className="text-sm font-semibold text-zinc-200 mb-1">
              Extracted items ({ext.items.length})
            </h2>
            {ext.items.map((it) => (
              <ExtractedItemRow key={it.item_id + it.start_offset} item={it} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

export default function JobInspectorPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [data, setData] = useState<JobInspectorPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getJobInspector(jobId).then(setData).catch((e) => setErr(String(e)));
  }, [jobId]);

  if (err) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-400">{err}</p>
        <p className="text-xs text-zinc-500">
          Jobs are kept in memory on the backend; if the container restarted
          since this job ran the trace is no longer available. Try{" "}
          <a href="/task1" className="text-blue-400 underline">/task1</a> or{" "}
          <a href="/task2" className="text-blue-400 underline">/task2</a> to run a
          fresh job.
        </p>
      </div>
    );
  }
  if (!data) return <p className="text-xs text-zinc-500">Loading job {jobId}…</p>;

  if (data.kind === "task2") return <Task2View data={data} />;
  return <Task1View data={data} />;
}
