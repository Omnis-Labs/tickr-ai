"use client";

import { useState } from "react";
import {
  EdgarParseError,
  EdgarParseResult,
  ExtractedItem,
  Task2Job,
  createExtraction,
  parseEdgarInput,
  pollExtraction,
} from "@/lib/api";
import { Linkify, fmtUSD, fmtDuration } from "@/lib/format";

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function describeParseError(err: EdgarParseError): string {
  if (err.kind === "ticker_unknown") {
    const guess = err.company_guess ? ` (interpreted as ${err.company_guess}, ${err.ticker})` : "";
    return `Ticker not in SEC's public registry${guess}. Try a US-listed ticker or paste a direct EDGAR URL.`;
  }
  if (err.kind === "unsupported") {
    return err.reason || "Only 10-K filings are supported.";
  }
  if (err.kind === "filing_not_found") {
    return err.message || `No 10-K found for ${err.ticker}${err.year ? " " + err.year : ""}.`;
  }
  if (err.kind === "refuse") {
    return (err.reason || "Could not interpret as an SEC 10-K request.") +
      " Try a company name like 'Apple', a ticker like 'JPM 2023', or a direct EDGAR URL.";
  }
  return err.message || err.reason || "Could not parse input.";
}

const EXAMPLES: { label: string; url: string }[] = [
  {
    label: "AAPL 2023 10-K",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
  },
  {
    label: "MSFT 2023 10-K",
    url: "https://www.sec.gov/Archives/edgar/data/789019/000095017023035122/msft-20230630.htm",
  },
  {
    label: "AAPL 2015 (pre-iXBRL)",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000119312515356351/d17062d10k.htm",
  },
];

const STATUS_COLOR: Record<string, string> = {
  pending: "text-zinc-400",
  running: "text-cyan-400",
  succeeded: "text-emerald-400",
  failed: "text-red-400",
  quarantined: "text-yellow-400",
};

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

function methodBadge(method: string): string {
  if (method === "L1") return "bg-emerald-900/40 text-emerald-300 border-emerald-700/50";
  if (method === "L2") return "bg-blue-900/40 text-blue-300 border-blue-700/50";
  if (method === "L3") return "bg-purple-900/40 text-purple-300 border-purple-700/50";
  return "bg-zinc-800 text-zinc-400 border-zinc-700";
}

function ItemCard({ item }: { item: ExtractedItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-md ${confidenceBg(item.confidence)}`}>
      <button
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-xs hover:bg-white/2"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-zinc-100 font-mono font-semibold w-16 shrink-0">
          Item {item.item_id}
        </span>
        <span className="flex-1 text-zinc-300 truncate">{item.title}</span>
        <span
          className={`font-mono font-semibold ${confidenceTone(item.confidence)}`}
          title="Calibrated confidence"
        >
          {(item.confidence * 100).toFixed(0)}%
        </span>
        <span className="text-zinc-500 font-mono w-20 text-right shrink-0">
          {item.char_length.toLocaleString()} ch
        </span>
        <span
          className={`text-[10px] font-mono uppercase border px-1.5 py-0.5 rounded ${methodBadge(
            item.extraction_method,
          )}`}
        >
          {item.extraction_method}
        </span>
        <span className="text-zinc-600 w-4 text-center">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-zinc-300 border-t border-zinc-800/50 pt-3 space-y-2">
          {item.notes && (
            <div className="text-orange-400 font-mono">
              note: {item.notes}
            </div>
          )}
          <div className="text-zinc-500 font-mono text-[10px]">
            offset {item.start_offset.toLocaleString()} … {item.end_offset.toLocaleString()}
          </div>
          <div className="max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed text-zinc-200">
            <Linkify text={item.content.slice(0, 5000)} />
            {item.content.length > 5000 && (
              <div className="text-zinc-600 mt-2">
                … (truncated; {(item.char_length - 5000).toLocaleString()} more chars
                — see /jobs/{"{job_id}"} for full text)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Task2Page() {
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Task2Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [interpretation, setInterpretation] = useState<EdgarParseResult | null>(null);
  const [parsing, setParsing] = useState(false);

  async function submit() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    setInterpretation(null);

    let resolvedUrl = "";
    if (looksLikeUrl(trimmed)) {
      resolvedUrl = trimmed;
      setInterpretation({ url: trimmed, interpretation: "Direct EDGAR URL" });
    } else {
      // Free-text → LLM parser → URL.
      setParsing(true);
      try {
        const ref = await parseEdgarInput(trimmed);
        resolvedUrl = ref.url;
        setInterpretation(ref);
        setUrl(ref.url);
      } catch (e) {
        const er = e as EdgarParseError;
        setErr(describeParseError(er));
        setBusy(false);
        setParsing(false);
        return;
      }
      setParsing(false);
    }

    try {
      const j = await createExtraction(resolvedUrl);
      setJob(j);
      pollExtraction(j.job_id, (next) => {
        setJob(next);
        if (next.status !== "pending" && next.status !== "running") setBusy(false);
      });
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  function reset() {
    setJob(null);
    setErr(null);
    setBusy(false);
  }

  async function copyJobLink() {
    if (!job) return;
    try {
      const link = `${window.location.origin}/jobs/${job.job_id}`;
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard errors */
    }
  }

  const ext = job?.extraction;
  const finished = job?.status === "succeeded" || job?.status === "failed" || job?.status === "quarantined";

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[300px]">
          <h1 className="text-2xl font-semibold">Task 2 — SEC 10-K Item Extractor</h1>
          <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
            Paste any EDGAR 10-K URL. Layered pipeline:{" "}
            <code className="text-emerald-400">L1</code> anchor →{" "}
            <code className="text-blue-400">L2</code> structural →{" "}
            <code className="text-purple-400">L3</code> LLM self-consistency →{" "}
            <code className="text-yellow-400">quarantine</code> if confidence stays
            low. Each layer only runs when cheaper layers fall short — most filings
            finish at L1 with $0 LLM cost.
          </p>
        </div>
        <a
          href="/dashboard#task2-capabilities"
          className="text-xs text-blue-400 hover:text-blue-300 border border-blue-800/40 hover:border-blue-600 rounded-md px-3 py-1.5 whitespace-nowrap"
          title="Concrete eval-proven filings + known failure cases + typed-refusal categories"
        >
          What works / what doesn&apos;t ↗
        </a>
      </section>

      <section className="border border-zinc-800 rounded-md p-4 space-y-3">
        <input
          type="text"
          className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono focus:outline-none focus:border-emerald-700"
          placeholder="e.g. 'Apple 2024', 'JPM 2023 10-K', '微軟 年報', or paste a full EDGAR URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          Type anything — the system parses with a cheap LLM call (~$0.0001).
          Examples:&nbsp;
          <code className="text-zinc-300">Apple 2024</code>,&nbsp;
          <code className="text-zinc-300">JPM 2023 10-K</code>,&nbsp;
          <code className="text-zinc-300">微軟 年報</code>,&nbsp;
          <code className="text-zinc-300">Tesla</code>, or a full EDGAR URL.
          Foreign filers (20-F) and non-10-K forms (10-Q etc.) get a typed
          refusal rather than wrong data.
        </p>
        {interpretation && !err && (
          <div className="border border-emerald-800/50 bg-emerald-950/20 rounded p-2 text-xs text-zinc-200 flex items-center gap-2">
            <span className="text-emerald-400 font-semibold">Resolved →</span>
            <span>{interpretation.interpretation}</span>
            {interpretation.parse_cost_usd !== undefined && interpretation.parse_cost_usd > 0 && (
              <span className="text-zinc-500 ml-auto">
                parser cost ${interpretation.parse_cost_usd.toFixed(6)}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.url}
              onClick={() => setUrl(ex.url)}
              className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-600"
              disabled={busy}
              title={ex.url}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || !url.trim()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-zinc-50 text-sm rounded transition-colors"
          >
            {parsing ? "Parsing…" : busy ? "Extracting…" : "Extract items"}
          </button>
          {finished && (
            <button
              onClick={reset}
              className="px-3 py-2 border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm rounded"
            >
              Extract another
            </button>
          )}
          {job && (
            <>
              <a
                href={`/jobs/${job.job_id}`}
                className="px-3 py-2 border border-zinc-700 hover:border-blue-500 hover:text-blue-300 text-zinc-300 text-sm rounded"
              >
                View trace ↗
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
        {job?.error_message && (
          <p className="text-sm text-red-400">crash: {job.error_message}</p>
        )}
        {job && (
          <p className="text-xs text-zinc-500">
            job <code className="text-zinc-300">{job.job_id}</code> · status{" "}
            <code className={STATUS_COLOR[job.status] || "text-zinc-300"}>
              {job.status}
            </code>
          </p>
        )}
      </section>

      {ext && (
        <>
          {/* ----- KPI bar ----- */}
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Coverage</div>
              <div className="text-2xl font-semibold text-zinc-100">
                {ext.n_found_items} / {ext.n_expected_items}
              </div>
              <div className="text-xs text-zinc-500">
                {(ext.coverage_ratio * 100).toFixed(0)}% required items
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Overall confidence</div>
              <div className={`text-2xl font-semibold ${confidenceTone(ext.overall_confidence)}`}>
                {(ext.overall_confidence * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-500">
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
                <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${methodBadge("L1")}`}>
                  L1 {ext.extraction_method_summary.L1 || 0}
                </span>
                <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${methodBadge("L2")}`}>
                  L2 {ext.extraction_method_summary.L2 || 0}
                </span>
                <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${methodBadge("L3")}`}>
                  L3 {ext.extraction_method_summary.L3 || 0}
                </span>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Cost / Duration</div>
              <div className="text-2xl font-semibold text-zinc-100">
                {fmtUSD(ext.cost_usd)}
              </div>
              <div className="text-xs text-zinc-500">
                {fmtDuration(ext.duration_ms)}
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3 col-span-2 md:col-span-1">
              <div className="text-xs text-zinc-500 uppercase">Filing</div>
              <div className="text-xs font-mono text-zinc-200 mt-1">
                CIK {ext.filing.cik || "—"}
              </div>
              <div className="text-xs font-mono text-zinc-500 truncate">
                {ext.filing.accession_number || "—"}
              </div>
            </div>
          </section>

          {/* ----- Source URL ----- */}
          {ext.filing.source_url && (
            <section className="border border-zinc-800 rounded-md p-3 text-xs flex flex-wrap items-center gap-2">
              <span className="text-zinc-500 uppercase">Source filing →</span>
              <Linkify text={ext.filing.source_url} className="font-mono" />
            </section>
          )}

          {/* ----- Quarantine / soft warnings ----- */}
          {ext.quarantine_reasons.length > 0 && (
            <section
              className={`border rounded-md p-3 text-xs ${
                ext.quarantined
                  ? "border-red-800/60 bg-red-950/30"
                  : "border-yellow-800/60 bg-yellow-950/20"
              }`}
            >
              <div
                className={`font-semibold mb-1 ${
                  ext.quarantined ? "text-red-300" : "text-yellow-300"
                }`}
              >
                {ext.quarantined ? "QUARANTINED" : "Soft warnings"}
              </div>
              <ul className="space-y-0.5 list-disc list-inside text-zinc-300">
                {ext.quarantine_reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {/* ----- Items ----- */}
          <section className="space-y-1.5">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-sm font-semibold text-zinc-300">
                Extracted items
              </h2>
              <span className="text-xs text-zinc-500">
                {ext.items.length} items · click any row to expand
              </span>
            </div>
            {ext.items.map((it) => (
              <ItemCard key={it.item_id + it.start_offset} item={it} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
