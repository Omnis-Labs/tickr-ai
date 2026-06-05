# ADR-004 — Self-consistency as ground-truth-free validation

**Date:** 2026-05-21
**Status:** Accepted
**Context for:** Task 2 — 10-K Extractor L3 + confidence model.

## Context

The rubric explicitly asks: "how do you verify yourself without public ground
truth?" There is no SEC-blessed corpus of "here are the correct Item
boundaries" — manual annotation across hundreds of filings is the only
authoritative reference, and it's not practical.

But we still need to know whether an extraction is correct *before* serving
it. "Did it work" cannot be left to humans-in-the-loop on every job.

The standard production trick for label-free validation in this regime is
**self-consistency**: ask the same question two independent ways, accept the
answer only when they agree. This is the principle behind majority-vote
sampling for code generation, the dual-prompt RAG check for retrieval, and
inter-model consensus for content moderation.

## Decision

For each "suspect" 10-K item (low confidence after L1+L2), L3 runs **two
independent prompts** on the same input chunk:

- **Prompt A — per-item probe.** "Find the boundaries of Item 7."
- **Prompt B — whole-chunk scan.** "List every item heading in this chunk."

Both return `body_start_offset` for Item 7 in chunk-relative coordinates.
We compute boundary disagreement Δ = |A.start − B.start|.

| Δ | Decision |
|---|---|
| ≤ 500 chars (in a 12 KB chunk → ~4% of chunk) | **Accept.** Emit an L3 `ExtractedItem`. |
| > 500 chars | **Reject.** Do not override L1/L2; leave the item in quarantine. |

This is what the PLAN calls boundary-IoU validation in spirit (an end-offset
IoU would be even stronger; we use start-only because end is harder to
disambiguate from the next item's start, and start-IoU correlates strongly).

## Why two independent prompts

The prompts ask different *forms* of the question:

- **A** is *targeted* — "where exactly does Item 7 begin?"
- **B** is *enumerative* — "list every item heading."

If both hallucinate the same wrong answer they'd have to share the same
failure mode. They don't — A is anchored on a specific item id; B has to scan
the chunk and consider all items. Their failure modes are mostly disjoint:

- A might over-confidently invent a heading not in the chunk.
- B might miss a heading entirely.

Agreement between the two is therefore much stronger evidence of correctness
than either prompt alone.

## Consequences

### Positive

- **Ground-truth-free verification** that actually works empirically. In the
  smoke test on AAPL Item 7, A reported `body_start_offset=7099`, B reported
  `7080`, Δ=19 → accepted.
- **No silent overrides.** L3 can only *add* items L1/L2 missed or *refine*
  low-confidence ones; it cannot silently delete a high-confidence L1 item.
- **Cost is bounded.** Two LLM calls per suspect item; we cap suspect probes
  at the per-filing budget ($0.10 default → ~25 probes). Filings hitting the
  cap surface the cap reason in `quarantine_reasons`.

### Negative

- **2× LLM cost when L3 fires.** $0.001–0.005 per item probe × 2 prompts.
  Mitigated by L3 only firing on suspect items.
- **Prompts must agree on convention.** During development A defined
  `body_start_offset = after the heading line` and B defined it as `at the
  heading`. Result: every probe disagreed by ~heading-length chars. Fixed by
  pinning both to "first character of the heading line." Lesson: shared
  conventions belong in the system prompt, not the user template, so they
  can't be paraphrased away.

## Alternatives considered

- **LLM-as-judge with a third prompt.** More expensive and adds a hierarchy
  problem ("who watches the watcher?"). Self-consistency is symmetric.
- **Cross-year consistency** (item lengths should track this filer's prior
  year). Better long-term signal but requires multi-year ingest we haven't
  built. Marked as a future improvement in PLAN.md §3.5 (w4).
- **Inter-model consensus** (Gemini vs Anthropic on same prompt). Stronger
  but adds another vendor dependency for a small marginal lift. Could be a
  future option.
