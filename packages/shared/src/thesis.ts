// Structured thesis tags. The Proposal Generator stores the set of tags
// that were "true at BUY time" on every proposal; the ws-server thesis-
// monitor re-runs the same predicates against current indicators every
// 5 minutes. When the majority of original tags has flipped to false,
// the monitor emits a SELL Proposal so the user can decide whether to
// exit.
//
// Tags are deterministic — they take a snapshot of the same
// IndicatorSnapshot the Signal Engine emits and return boolean. No LLM
// call at re-check time, so this can run cheaply on every position.
//
// The LLM still writes the natural-language rationale; tags are extracted
// after the indicator snapshot is computed and are not LLM-trusted (we
// don't ask the model to invent or pick tag ids — it would hallucinate).

export interface ThesisIndicatorSnapshot {
  rsi: number; // 0-100
  ma20: number;
  ma50: number;
  /** Last close. Same time scale as ma20 / ma50. */
  price: number;
  macd: { macd: number; signal: number; histogram: number };
}

export interface ThesisTagDef {
  id: string;
  /** Short human label shown in SELL modal. */
  label: string;
  /** Bucket for grouping in UI. */
  kind: 'TECHNICAL' | 'MOMENTUM' | 'TREND';
  predicate: (s: ThesisIndicatorSnapshot) => boolean;
}

/** Single registry. Add to this file (and any deterministic predicate),
 *  re-run prisma generate is NOT needed — tags are stored as opaque strings. */
export const THESIS_TAGS: readonly ThesisTagDef[] = [
  // ── RSI ────────────────────────────────────────────────────────────
  {
    id: 'rsi_oversold',
    label: 'RSI oversold (< 30) — mean-reversion entry',
    kind: 'MOMENTUM',
    predicate: (s) => s.rsi < 30,
  },
  {
    id: 'rsi_recovering',
    label: 'RSI in 30–50 — recovering from oversold',
    kind: 'MOMENTUM',
    predicate: (s) => s.rsi >= 30 && s.rsi < 50,
  },
  {
    id: 'rsi_neutral',
    label: 'RSI neutral (50–70) — no exhaustion',
    kind: 'MOMENTUM',
    predicate: (s) => s.rsi >= 50 && s.rsi <= 70,
  },
  {
    id: 'rsi_not_overbought',
    label: 'RSI < 70 — not in overbought territory',
    kind: 'MOMENTUM',
    predicate: (s) => s.rsi < 70,
  },

  // ── Moving averages ────────────────────────────────────────────────
  {
    id: 'price_above_ma20',
    label: 'Price above MA20 — short-term uptrend',
    kind: 'TREND',
    predicate: (s) => s.price > s.ma20,
  },
  {
    id: 'price_above_ma50',
    label: 'Price above MA50 — medium-term uptrend',
    kind: 'TREND',
    predicate: (s) => s.price > s.ma50,
  },
  {
    id: 'ma20_above_ma50',
    label: 'MA20 above MA50 — golden-cross zone',
    kind: 'TREND',
    predicate: (s) => s.ma20 > s.ma50,
  },

  // ── MACD ────────────────────────────────────────────────────────────
  {
    id: 'macd_bullish',
    label: 'MACD line above signal — momentum bullish',
    kind: 'TECHNICAL',
    predicate: (s) => s.macd.macd > s.macd.signal,
  },
  {
    id: 'macd_histogram_positive',
    label: 'MACD histogram positive — momentum expanding',
    kind: 'TECHNICAL',
    predicate: (s) => s.macd.histogram > 0,
  },
];

const tagsById = new Map<string, ThesisTagDef>();
for (const t of THESIS_TAGS) tagsById.set(t.id, t);

export function getThesisTag(id: string): ThesisTagDef | undefined {
  return tagsById.get(id);
}

/**
 * Pick which tags from the registry are currently true. Used by the Proposal
 * Generator at BUY time to snapshot the supporting thesis.
 */
export function extractThesisTags(s: ThesisIndicatorSnapshot): string[] {
  const out: string[] = [];
  for (const t of THESIS_TAGS) {
    try {
      if (t.predicate(s)) out.push(t.id);
    } catch {
      // bad indicator (NaN etc.) — skip silently rather than blowing up
      // the whole proposal pipeline
    }
  }
  return out;
}

export interface ThesisEvaluation {
  /** Tags that were true at BUY *and* still true now. */
  stillTrue: string[];
  /** Tags that were true at BUY but are now false. */
  invalidated: string[];
  /** original tag count — denominator for the majority check. */
  originalCount: number;
  /** True if more than half the original tags are now invalidated. */
  shouldExit: boolean;
  /** Tag whose flip pushed the count over the threshold (or null if none
   *  did this tick). */
  triggeringTag: string | null;
}

/**
 * Compare original BUY-time tags against the current indicator snapshot.
 * Conservative: emits shouldExit only when STRICTLY more than half the
 * original tags have flipped. (5/9 → exit, 4/8 → no-exit-yet.)
 */
export function evaluateThesis(
  originalTags: readonly string[],
  current: ThesisIndicatorSnapshot,
  // The tag whose flip we detected this tick — informational, exposed as
  // triggeringTag on the SELL proposal.
  newlyFlippedThisTick?: string,
): ThesisEvaluation {
  const stillTrue: string[] = [];
  const invalidated: string[] = [];
  for (const id of originalTags) {
    const tag = tagsById.get(id);
    if (!tag) {
      // Unknown tag id (registry shrunk) — treat as still true so we don't
      // false-positive a SELL on schema drift.
      stillTrue.push(id);
      continue;
    }
    try {
      if (tag.predicate(current)) stillTrue.push(id);
      else invalidated.push(id);
    } catch {
      stillTrue.push(id); // safety net
    }
  }
  const originalCount = originalTags.length;
  const shouldExit =
    originalCount > 0 && invalidated.length * 2 > originalCount;
  return {
    stillTrue,
    invalidated,
    originalCount,
    shouldExit,
    triggeringTag: shouldExit
      ? newlyFlippedThisTick ?? invalidated[invalidated.length - 1] ?? null
      : null,
  };
}
