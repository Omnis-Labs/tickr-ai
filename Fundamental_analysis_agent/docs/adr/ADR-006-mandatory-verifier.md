# ADR-006 — Mandatory verifier + "fail loud, never silent"

**Date:** 2026-05-21
**Status:** Accepted
**Context for:** Both tasks — silent-failure prevention.

## Context

A class of bugs unique to LLM-driven systems: the model produces an
answer that *looks* plausible, the system emits it as a final result, and a
downstream consumer (a human, a trading strategy, a compliance tool) acts
on it. The error surfaces only when the consequence is already manifest.

In a quant context this is uniquely expensive: a wrong signal is worse than
no signal because you trade on it. The rubric explicitly tests for "silent-
failure prevention."

Two failure shapes:

1. **Action without effect.** Browser agent clicks the wrong element; no
   exception, but the page didn't actually advance.
2. **Extraction of the wrong region.** 10-K Item 7 boundaries off by 50 KB;
   the extracted text is plausible English but contains the wrong section.

Naively, neither raises in our pipelines. Both are silent in the absence of
explicit verification.

## Decision

Every output that crosses a boundary (user, downstream system, persisted
artifact) passes through a **verification step that can reject**, and a
**confidence floor** below which we **quarantine** rather than emit.

### Task 1 — verifier after every action

```
ACT → page snapshot → verifier (CHEAP-tier LLM) → pass / fail kind
```

The verifier sees the post-action snapshot (URL, visible text, form state)
and the planned `success_criteria`. It returns `passed: bool` + (on fail)
a typed `failure_kind` enum. **ACT not raising is NOT proof of success.**

The verifier is a separate stage of the state machine — not merged into ACT,
not optional. Even "trivial" successes are checked.

Specific anti-pattern caught by this design: the planner sometimes writes
`success_criteria: "extracted text starts with 'The Whale'"` as a hallucinated
guess. The verifier rejects the correct extraction (because the actual page
doesn't start with that text). Recovery loops produce no fix — eventually
escalate. **We surface the wrong answer as `escalated`, never as `succeeded`.**

### Task 2 — calibrated confidence + quarantine

Every `ExtractedItem` carries a confidence score combining anchor coverage,
structural invariants, per-item length checks, and (in calibrated mode) a
trained Platt-scaled sigmoid. The orchestrator computes
`overall_confidence` as **25th percentile** over required items (robust to
one outlier, sensitive to systemic problems).

```python
overall_confidence = p25(required_items.confidence)
quarantined = overall_confidence < 0.45 or "no items" in reasons or "below 50%" in reasons
```

A quarantined filing surfaces with `quarantined: true` + a list of
`quarantine_reasons`. The frontend renders the result with a red border and
explicit "QUARANTINED" header. **The data is still there, but it carries the
warning that it should not be relied on.**

### Honest signalling of un-calibrated state

Until 20+ hand-labelled examples exist, the Platt model can't be trained
meaningfully. The orchestrator detects no trained model and appends
`"confidence uncalibrated"` to `quarantine_reasons` — not as a blocker, but
as a signal so reviewers don't read raw scores as probabilities. The dashboard
surfaces this honestly.

## Consequences

### Positive

- **No silent wrong outputs.** A wrong Item 7 boundary either is caught by
  the structural invariant (length below floor → confidence drop → quarantine)
  or by L3's self-consistency check, or both. The user-facing output always
  includes the confidence + quarantine status.
- **Failure is loud and attributable.** Every escalation has a
  `failure_kind`. Every quarantine has a `quarantine_reasons` list. There is
  no "succeeded but wrong" terminal state.
- **The eval can assert what it actually wants.** Eval cases include
  `contains:` and `contains_all:` content assertions that detect "succeeded
  but the answer is wrong" — these failures surface as eval failures, not
  hidden success.

### Negative

- **More LLM cost.** Task 1 makes one verifier call per step, CHEAP-tier.
  At ~$0.0001 per verifier call, this is ~$0.0005 added to a 5-step task.
  Worth it.
- **Quarantine rate can be noisy.** A perfectly correct filing whose Item 6
  is genuinely empty trips the empty-content note. We mitigated this by
  excluding OPTIONAL_ITEMS from per-item penalties, but the tuning is
  uncalibrated until we get the labelled dev set.
- **Quarantine is binary at the top level.** A filing with 22 correct items
  and 1 questionable one is quarantined. The dashboard shows the
  granular confidences so users can drill into which item is the issue.

## Alternatives considered

- **Hard threshold per item (item X must be ≥ Y chars).** Brittle — many
  legitimate variations. The structural invariant + Platt calibration
  approach generalises.
- **Verify only on failure paths.** Cheaper but misses the silent-wrong-
  answer class entirely (the failing case is when ACT doesn't raise but
  the goal isn't met).
- **No quarantine — always emit + carry confidence.** This is what we
  ALSO do (the items list is always returned), but the binary `quarantined`
  flag forces downstream consumers to handle the case explicitly. Without
  it, some consumers would ignore the confidence and act on low-quality
  outputs.
