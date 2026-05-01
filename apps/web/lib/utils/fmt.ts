// Null-safe number formatters.
//
// API failures, race-conditions during hydration, and Decimal columns
// that arrive as strings can all leave numeric props as null/undefined
// /NaN. Calling .toFixed() / .toLocaleString() on those crashes the
// React tree with "is not a function". These helpers degrade to a
// stable em-dash so the UI stays mounted while the data settles.
//
// Use these for ANY user-visible number that originates from an API
// or store. Local-only computations (e.g. summing a typed array) can
// still call .toFixed directly.

const SAFE_PLACEHOLDER = '—';

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export interface FmtOpts {
  /** Decimal places. Default 2. */
  digits?: number;
  /** What to render when the value is null/undefined/NaN. Default "—". */
  fallback?: string;
}

/** "$1,234.56" or fallback. */
export function fmtUsd(n: number | null | undefined, opts: FmtOpts = {}): string {
  if (!isNum(n)) return opts.fallback ?? SAFE_PLACEHOLDER;
  const digits = opts.digits ?? 2;
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** "+1.23%" / "-4.56%" / fallback. */
export function fmtPct(n: number | null | undefined, opts: FmtOpts & { signed?: boolean } = {}): string {
  if (!isNum(n)) return opts.fallback ?? SAFE_PLACEHOLDER;
  const digits = opts.digits ?? 1;
  const v = (n * 100).toFixed(digits);
  if (opts.signed && n >= 0) return `+${v}%`;
  return `${v}%`;
}

/** Plain number with locale separators. "1,234.56" or fallback. */
export function fmtNum(n: number | null | undefined, opts: FmtOpts = {}): string {
  if (!isNum(n)) return opts.fallback ?? SAFE_PLACEHOLDER;
  const digits = opts.digits ?? 2;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Token amount with sensible default of 4 decimals. */
export function fmtTokens(n: number | null | undefined, opts: FmtOpts = {}): string {
  return fmtNum(n, { digits: 4, ...opts });
}

/** "+$12.34" / "-$5.00" / fallback. Useful for PnL displays. */
export function fmtSignedUsd(n: number | null | undefined, opts: FmtOpts = {}): string {
  if (!isNum(n)) return opts.fallback ?? SAFE_PLACEHOLDER;
  const sign = n >= 0 ? '+' : '-';
  return `${sign}${fmtUsd(Math.abs(n), opts)}`;
}

/** Coerce a number-or-null into a number for a downstream computation
 *  (e.g. summing). Returns 0 by default; pass a different fallback
 *  when the math semantics differ. */
export function num(n: number | null | undefined, fallback = 0): number {
  return isNum(n) ? n : fallback;
}
