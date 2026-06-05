# ADR-007 — Hard structural quarantine gate over core substance items

**Date:** 2026-06-04
**Status:** Accepted
**Context for:** Task 2 — SEC 10-K item-level extraction.
**Supersedes the quarantine policy in** [ADR-002](ADR-002-layered-extraction-pipeline.md) **(score-only).**

## Context

ADR-002 quarantines a filing when the learned confidence score stays below
`QUARANTINE_THRESHOLD = 0.45` after all extraction layers. That score is a
Platt-calibrated logistic over anchor coverage + structural invariants, fit on
the curated 20-case eval (where scores spread 0.3–0.95).

The real-world sweep ([`docs/analysis/real_world_sweep.md`](../analysis/real_world_sweep.md),
25 untuned large-cap filers) exposed a fatal flaw in a score-only gate:

- On out-of-distribution filings the score **collapses to a ~0.50 cluster**
  (median 0.509, 24/25 between 0.47 and 0.52) almost independently of whether
  extraction succeeded.
- That cluster sits *just above* the 0.45 threshold, so **0 of 25 filings were
  quarantined** — including Citigroup, whose entire MD&A (Item 7) was missing,
  and Intel, whose Business (Item 1) and Financial Statements (Item 8) were
  truncated to a TOC stub.

A confidence model that returns ~0.5 for both a clean extraction and one with
its MD&A missing is not a usable safety signal out-of-distribution, which is
exactly where a safety signal matters most. Re-fitting the logistic needs
labelled out-of-distribution data we do not have.

## Decision

Add a **deterministic structural gate** that is independent of the learned
score. The four substance items of a 10-K — **Item 1 (Business), 1A (Risk
Factors), 7 (MD&A), 8 (Financial Statements)** — must each be present and at or
above a length floor. Any missing/truncated core item quarantines the filing
regardless of the score.

```
quarantined = (score < 0.45)            # ADR-002, kept as a floor
            OR core_item_gate(items)     # NEW — the operative signal in practice
            OR no-items / <50%-coverage  # ADR-002 fatal reasons
```

`core_item_gate` ([`pipeline/confidence.py`](../../task2_10k_extractor/pipeline/confidence.py))
returns a human-readable reason per failed core item (e.g.
`"core item 7 (MD&A) missing"`), which flows into `quarantine_reasons` so the
dashboard shows *why*.

### Incorporation by reference is not a failure

Some core items are legitimately short because their substance is filed
elsewhere. The gate must not false-flag these, and — equally — must not be
fooled into passing a real failure. [`pipeline/recover.py`](../../task2_10k_extractor/pipeline/recover.py)
runs before the gate and sets `incorporated_by_reference=True` only when:

- **Part III (Items 10–14):** the cover-page "Documents Incorporated by
  Reference … Proxy Statement" note is present and the item body is short.
- **Item 8 → Item 15:** an explicit reference phrase is present **and** the
  consolidated financial statements are *actually captured* in some sizeable
  extracted item (verified by content markers like "Consolidated Balance
  Sheets"). The second condition is essential: without it, the Item-15
  exhibit-index boilerplate would let us mark Item 8 "incorporated" even when
  we never captured the statements — hiding a failure, the opposite of intent.

A deterministic gap-fill pass also reconstructs a core item that is cleanly
bracketed by two trustworthy neighbours, but refuses when the bracketing span
is implausibly large or contains other anchors (unsound structure → let the
gate quarantine rather than manufacture content).

## Consequences

**Measured on the 25-ticker sweep (before → after):**

| | Score-only (ADR-002) | + structural gate (this ADR) |
|---|---|---|
| Filings flagged when a core item is missing/truncated | **0 / 8** | **8 / 8** |
| Quarantine rate | 0/25 | 8/25 (32%) |
| False quarantines (clean filing wrongly flagged) | — | **0** (all 8 verified real: MD&A or financials truncated) |
| Citi (MD&A missing) caught | ✗ silent | ✓ quarantined |

- **The system now knows when it failed.** It never silently returns a 10-K
  with a missing or garbled substance section. That is the reliability property
  we were missing.
- **It does not improve raw extraction** on the hard cases (Citi/Intel heading-
  detection collapse — see real_world_sweep.md). Those are now reliably
  *refused* rather than silently mis-extracted. Fixing the extraction itself is
  a normalize-layer change tracked as future work.
- The learned score is retained as a lower floor and still surfaced, but is no
  longer the operative quarantine signal in production.

## Alternatives considered

- **Re-fit the Platt model on real filings.** Correct long-term, but needs
  labelled out-of-distribution data. The structural gate is the cheap, robust
  bridge and is arguably the right primary signal regardless.
- **Lower the threshold to 0.52** to catch the cluster. Would quarantine
  *everything*, including clean filings — no discrimination. Rejected.
