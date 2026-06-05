import React from "react";

/**
 * Linkify — auto-detect URLs in a text string and render them as
 * clickable external links. Used in both Task 1 (final output) and
 * Task 2 (extracted item content) so any extracted text that looks
 * like a URL becomes navigable without re-prompting.
 *
 * Plain http(s) detection only — we do not try to be clever about
 * markdown or HTML escaped fragments. Anything not a URL renders
 * as plain text.
 */
const URL_RE = /\b(https?:\/\/[^\s<>"'　]+)/g;

export function Linkify({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(<span key={`t-${key++}`}>{text.slice(lastIndex, m.index)}</span>);
    }
    let url = m[1];
    // Strip trailing punctuation commonly stuck to URLs at the end of sentences.
    let trailing = "";
    while (url && /[).,;:!?]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    parts.push(
      <a
        key={`a-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 underline decoration-blue-400/40 hover:decoration-blue-400 underline-offset-2 break-all"
      >
        {url}
      </a>,
    );
    if (trailing) parts.push(<span key={`p-${key++}`}>{trailing}</span>);
    lastIndex = m.index + m[1].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(lastIndex)}</span>);
  }
  return <span className={className}>{parts}</span>;
}

/** True when the entire string is a single http(s) URL with nothing else. */
export function isBareUrl(s: string): boolean {
  const t = s.trim();
  return /^https?:\/\/\S+$/.test(t);
}

/** Truncate visible URLs to keep cards compact; the underlying href stays full. */
export function shortenUrl(url: string, max = 72): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + "…";
}

export function fmtUSD(v: number, digits = 4): string {
  return `$${v.toFixed(digits)}`;
}

export function fmtDuration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}
