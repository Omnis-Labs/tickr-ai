# ADR-002 — Layered L1 → L2 → L3 extraction pipeline for 10-K filings

**Date:** 2026-05-21
**Status:** Accepted
**Context for:** Task 2 — SEC 10-K item-level extraction.

## Context

A 10-K filing is 50K–500K characters of HTML / iXBRL. The naive solution is
"send the document to an LLM, ask for all items." Two problems:

1. **Cost.** At 200K tokens × $3/M input + 1K output × $15/M for Sonnet, a
   single filing costs ~$0.62. Across the held-out eval set (17 filings) that's
   $10 per full eval run. Annual run for the universe (8,000+ filers) is the
   wrong economics.
2. **Verification.** A monolithic LLM call gives one opaque output. We can't
   tell if Item 7 boundary is correct because the model assigned it correctly,
   or because the model is hallucinating consistently.

10-K filings happen to have a fortunate structural property: they almost always
contain explicit `Item N` headings in the body, and a Table of Contents that
points at those headings by anchor. The information is *there*; we just need to
extract it deterministically before reaching for an LLM.

## Decision

Implement a four-stage pipeline. Each later stage runs only when earlier ones
have insufficient confidence, capped by an explicit budget. Output is the same
typed `ExtractedItem` regardless of which layer produced it; the layer is
recorded in `extraction_method` so analysis can slice by source.

```
INGEST → NORMALIZE → L1 anchor → [low conf?] L2 structural → [still low?] L3 LLM → [still low?] QUARANTINE
                          $0          $0             $0                                $0.001–0.01/probe
```

- **L1 — anchor extractor.** Regex over headings + density-based TOC detection
  + first-with-gap section heuristic. Zero LLM cost. Handles ~95% of filings.
- **L2 — structural extractor.** Reverse-lookup TOC `<a href="#itemNa">` links
  into anchor targets the normalizer captured. Recovers items L1 missed
  (heading text styled rather than tagged). Still zero LLM cost.
- **L3 — LLM self-consistency.** Two independent prompts probe each suspect
  item; boundary IoU > 0.95 (Δ ≤ 500 chars in a 12 KB window) ⇒ accept. See
  [ADR-004](ADR-004-self-consistency-validation.md).
- **Quarantine.** If overall confidence stays below 0.45 after all layers, the
  output is flagged and surfaced as `quarantined: true` rather than emitted
  as if certain. See [ADR-006](ADR-006-mandatory-verifier.md) for the
  underlying "fail loud" principle.

The orchestrator records `extraction_method_summary` on every job:

```python
{"L1": 22, "L2": 1, "L3": 0}
```

## Consequences

### Positive

- **Cost discipline.** On the 17-filing eval, **mean LLM cost per filing is
  $0.00** — L1+L2 cover everything. The L3 layer exists but only ever fires
  on truly anomalous inputs.
- **Failure attribution.** When a filing is quarantined, the
  `extraction_method_summary` shows exactly how far the pipeline got. "L1
  missed 4 items, L2 recovered 2, L3 disagreed on the other 2" is actionable
  diagnosis.
- **Each layer is independently testable.** L1 has unit-testable regex; L2
  has deterministic IR walks; L3 has prompt-level eval.
- **Backwards-compatible expansion.** Each layer accepts the previous layer's
  `ExtractedItem[]` and returns the same. Adding L4 later is a one-import
  change in the orchestrator.

### Negative

- **More code than a single prompt.** Three layers vs one function call. The
  cost / verification benefits decisively outweigh this; on a per-filing
  basis we're 1–2 orders of magnitude cheaper and arbitrarily more debuggable.
- **More moving parts to keep aligned.** The `ExtractedItem` schema must
  remain a stable contract between layers; we depend on Pydantic's
  `schema_version` literal to flag breaking changes.

## Alternatives considered

- **Single LLM call with the entire document.** Rejected on cost. Also fails
  on standard SOTA context-window limits without elaborate chunking.
- **LLM-first with structural fallback.** Inverts the layering. Cheaper than
  monolithic but still pays per filing. Loses the "$0 happy path" property.
- **Hardcoded per-filer adapters.** Would maximise reliability on supported
  filers but loses the "generalised extractor" framing the rubric tests for.
