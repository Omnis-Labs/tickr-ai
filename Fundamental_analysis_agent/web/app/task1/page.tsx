"use client";

import { useMemo, useState } from "react";
import { createJob, JobView, StepEvent, subscribeEvents, PlannedStep } from "@/lib/api";
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
  pending: "text-zinc-400",
  running: "text-cyan-400",
  succeeded: "text-emerald-400",
  failed: "text-red-400",
  escalated: "text-orange-400",
};

const EXAMPLES = [
  "Search Wikipedia for 'Alan Turing' and extract the first paragraph of the article.",
  "Go to Hacker News and list the titles of the top 5 front-page stories.",
  "Search arxiv.org for 'sparse attention' and return the title of the first result.",
];

function extractStepIndex(key: string): number | null {
  const m = /^step_(\d+)$/.exec(key);
  return m ? parseInt(m[1], 10) : null;
}

function OutputCard({
  stepIndex,
  plan,
  value,
}: {
  stepIndex: number | null;
  plan: PlannedStep[];
  value: unknown;
}) {
  const step = stepIndex !== null ? plan.find((p) => p.index === stepIndex) : null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return (
    <div className="border border-emerald-800/40 bg-emerald-950/15 rounded-md p-4">
      <div className="flex items-center gap-2 mb-2">
        {stepIndex !== null && (
          <span className="text-[10px] font-semibold tracking-wider bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded">
            STEP {stepIndex}
          </span>
        )}
        {step?.action && (
          <span className="text-[10px] font-mono text-zinc-500 uppercase">
            {step.action}
          </span>
        )}
        {step?.target_description && (
          <span className="text-xs text-zinc-400 truncate">
            → {step.target_description}
          </span>
        )}
      </div>
      <div className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
        <Linkify text={text} />
      </div>
    </div>
  );
}

export default function Task1Page() {
  const [task, setTask] = useState("");
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (!task.trim()) return;
    setBusy(true);
    setErr(null);
    setEvents([]);
    setJob(null);
    try {
      const j = await createJob(task.trim());
      setJob(j);
      subscribeEvents(
        j.job_id,
        (ev) => setEvents((prev) => [...prev, ev]),
        (final) => {
          setJob(final);
          setBusy(false);
        },
      );
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  function reset() {
    setEvents([]);
    setJob(null);
    setErr(null);
    setBusy(false);
  }

  async function copyJobLink() {
    if (!job) return;
    try {
      const url = `${window.location.origin}/jobs/${job.job_id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard errors */
    }
  }

  const planSteps = useMemo<PlannedStep[]>(
    () => (job?.plan as PlannedStep[]) || [],
    [job],
  );

  const outputEntries = useMemo(() => {
    if (!job?.final_output) return [] as { key: string; stepIndex: number | null; value: unknown }[];
    return Object.entries(job.final_output)
      .map(([key, value]) => ({ key, stepIndex: extractStepIndex(key), value }))
      .sort((a, b) => {
        if (a.stepIndex === null && b.stepIndex === null) return 0;
        if (a.stepIndex === null) return 1;
        if (b.stepIndex === null) return -1;
        return a.stepIndex - b.stepIndex;
      });
  }, [job?.final_output]);

  const liveProgressDone = job?.status && job.status !== "pending" && job.status !== "running";

  return (
    <div className="space-y-6">
      {/* ----- Header ----- */}
      <section>
        <h1 className="text-2xl font-semibold">Task 1 — Browser Agent</h1>
        <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
          Submit a natural-language task. The agent runs an explicit state
          machine — <code className="text-cyan-400">PLAN</code> →{" "}
          <code className="text-cyan-400">LOCATE</code> →{" "}
          <code className="text-cyan-400">ACT</code> →{" "}
          <code className="text-cyan-400">VERIFY</code> per step, with{" "}
          <code className="text-orange-400">DIAGNOSE</code>-driven recovery on
          failure (not try/except).
        </p>
      </section>

      {/* ----- Submit form ----- */}
      <section className="border border-zinc-800 rounded-md p-4 space-y-3">
        <textarea
          className="w-full bg-zinc-900 border border-zinc-800 rounded p-3 text-sm font-mono focus:outline-none focus:border-emerald-700"
          rows={3}
          placeholder="e.g. Search Wikipedia for 'Alan Turing' and return the article's first paragraph."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2 text-xs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setTask(ex)}
              className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
              disabled={busy}
              title={ex}
            >
              {ex.slice(0, 60)}…
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || !task.trim()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-zinc-50 text-sm rounded transition-colors"
          >
            {busy ? "Running…" : "Run task"}
          </button>
          {liveProgressDone && (
            <button
              onClick={reset}
              className="px-3 py-2 border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm rounded"
            >
              Run another
            </button>
          )}
          {job && (
            <>
              <a
                href={`/jobs/${job.job_id}`}
                className="px-3 py-2 border border-zinc-700 hover:border-blue-500 hover:text-blue-300 text-zinc-300 text-sm rounded"
              >
                View detailed trace ↗
              </a>
              <button
                onClick={copyJobLink}
                className="px-3 py-2 border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm rounded"
                title="Copy a shareable URL to this job"
              >
                {copied ? "✓ Copied" : "Copy job link"}
              </button>
            </>
          )}
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </section>

      {/* ----- Job summary tiles (visible once we have a job) ----- */}
      {job && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="border border-zinc-800 rounded-md p-3">
            <div className="text-xs text-zinc-500 uppercase">Status</div>
            <div
              className={`text-lg font-semibold mt-0.5 ${
                STATUS_COLOR[job.status] || "text-zinc-300"
              }`}
            >
              {job.status}
            </div>
          </div>
          <div className="border border-zinc-800 rounded-md p-3">
            <div className="text-xs text-zinc-500 uppercase">Plan</div>
            <div className="text-lg font-semibold text-zinc-100 mt-0.5">
              {planSteps.length} step{planSteps.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="border border-zinc-800 rounded-md p-3">
            <div className="text-xs text-zinc-500 uppercase">Recovery</div>
            <div className="text-lg font-semibold mt-0.5">
              <span
                className={
                  (job.recovery_attempts ?? 0) > 0
                    ? "text-emerald-400"
                    : "text-zinc-600"
                }
              >
                {job.recovery_attempts ?? 0}
              </span>
            </div>
          </div>
          <div className="border border-zinc-800 rounded-md p-3">
            <div className="text-xs text-zinc-500 uppercase">Cost</div>
            <div className="text-lg font-semibold text-zinc-100 mt-0.5">
              {fmtUSD(job.total_cost_usd ?? 0)}
            </div>
          </div>
          <div className="border border-zinc-800 rounded-md p-3 col-span-2 md:col-span-1">
            <div className="text-xs text-zinc-500 uppercase">Job id</div>
            <div className="text-xs font-mono text-zinc-300 mt-1 truncate">
              {job.job_id}
            </div>
          </div>
        </section>
      )}

      {/* ----- Final output (structured, URL-aware) ----- */}
      {job?.final_output && Object.keys(job.final_output).length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-emerald-400">Final output</h2>
            <span className="text-xs text-zinc-500">
              {outputEntries.length} extracted value{outputEntries.length === 1 ? "" : "s"}
            </span>
          </div>
          {outputEntries.map(({ key, stepIndex, value }) => (
            <OutputCard
              key={key}
              stepIndex={stepIndex}
              plan={planSteps}
              value={value}
            />
          ))}
          {job.target_url && (
            <div className="text-xs text-zinc-500 pt-1">
              source page →{" "}
              <Linkify text={job.target_url} className="break-all" />
            </div>
          )}
        </section>
      )}

      {/* ----- Live progress (always shown) ----- */}
      <section className="border border-zinc-800 rounded-md p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold text-zinc-300">Live progress</h2>
          {events.length > 0 && (
            <span className="text-xs text-zinc-500">
              {events.length} event{events.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {events.length === 0 && (
          <p className="text-xs text-zinc-500">
            No events yet. Submit a task above and watch the state machine run
            step-by-step.
          </p>
        )}
        <ol className="space-y-1 text-xs font-mono">
          {events.map((e) => (
            <li key={e.sequence} className="flex gap-3 items-start">
              <span className="text-zinc-600 w-10 shrink-0">#{e.sequence}</span>
              <span
                className={`${STATE_COLOR[e.state] || "text-zinc-300"} shrink-0 w-24`}
              >
                [{e.state}
                {e.step_index !== null ? `:${e.step_index}` : ""}]
              </span>
              <span className="text-zinc-200 break-words">{e.message}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
