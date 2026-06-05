# Task 2 — Real-World 25-Ticker Sweep

> Random-ish stratified sample of 25 large-cap US-listed filers. Each filer's
> most recent 10-K fetched live from EDGAR and run through the full pipeline.
> No curation, no manual fixups. Output: [`real_world_sweep.json`](real_world_sweep.json).
>
> Built in response to interviewer feedback (2026-06-04) flagging that the
> curated 20-case eval — which reports 95 % pass / mean conf 0.896 — does
> not reflect what a real user gets when they paste an arbitrary ticker.
> This document records what they actually get.

## Why this exists

Up until 2026-06-04 the only Task 2 quality signal was [`task2_10k_extractor/eval/report.json`](../../task2_10k_extractor/eval/report.json) — 20 cases, 19 passing, mean confidence 0.896. The cases were curated for industry diversity, and the system was hyper-parameter-tuned (heading detection thresholds, gap-based picker, Platt calibration) against them.

The interviewer correctly noted that this curated number was not what they observed when pasting INTC and Citi. They both failed in production: INTC was quarantined at conf 0.328 with all required items < 250 chars, and Citi returned 0 items at conf 0.245.

This sweep was built to measure the **real production failure rate** on a sample where the system was never tuned to specific filers.

## Method

| Knob | Value |
|---|---|
| Sample size | 25 |
| Selection | 7 mega-cap tech + 9 industry rotation (banks/pharma/energy/retail/media/industrial) + 2 known-fail regression cases (INTC, C) + 7 other large-caps from S&P 500 |
| Filing fetched | EDGAR submissions API → most recent 10-K per filer |
| Pipeline | Same code path as production: ingest → normalize → L1 → L2 → L3 → confidence → calibration → quarantine |
| Harness | [`tools/sweep_random_tickers.py`](../../tools/sweep_random_tickers.py) |
| "Pass" criterion (harness `n_pass`) | Status==ok ∧ not quarantined ∧ no required items missing ∧ no required items with content < 500 chars |
| Honest substance metric (this doc) | All of Items 1 / 1A / 7 / 8 present and ≥500 chars ("core-4 intact") |

The harness's built-in `n_pass` / `pass_rate` is **mis-specified** — its <500-char rule flags Items 9–14 (Part III, legitimately incorporated by reference) on nearly every filer, so it reads 0/25 and is not informative. This doc reports the **core-4** metric instead, which tracks whether the four substance items (Business, Risk Factors, MD&A, Financial Statements) actually came through.

## Bug fix shipped during this work

The sweep was built alongside a fix for the L1 picker that triggered both INTC and Citi to fail. The fix is in [`task2_10k_extractor/pipeline/l1_anchor.py`](../../task2_10k_extractor/pipeline/l1_anchor.py): the picker now uses **gap-to-next-anchor (overall, not same-item)** as the section-opener signal, instead of the previous `is_toc` flag from `normalize.py`. The `is_toc` flag depended on detecting an explicit "PART I" styled heading, which several large-cap iXBRL filers (INTC, Citi, BAC, ...) do not emit.

Net effect on the two regression cases (BEFORE → AFTER):

| Filer | Before | After |
|---|---|---|
| INTC FY2025 | conf 0.33, quarantined, all required items < 250 chars | conf 0.50, not quarantined, Item 1A=105K, Item 7=58K. Items 1 + 8 still broken (heading detection in normalize.py misses INTC's section openers). |
| Citi FY2025 | 0 items, conf 0.25, quarantined | 19 items, conf 0.48, not quarantined, Item 1A=363K, Item 8=672K. Item 1 short + Item 7 missing (Citi uses neither "Management's Discussion" nor "Item 7." as a heading). |

This is a real improvement but not a complete fix — Item 1 (Business) and Item 7 (MD&A) for these two filers remain known failure modes. See "Known failure modes" below.

## Results

Full run: 25/25 tickers, 2026-06-04. Raw data: [`real_world_sweep.json`](real_world_sweep.json).

| Metric | Curated eval (20 cases) | Real-world sweep (25 tickers) |
|---|---|---|
| Pipeline ran end-to-end (no resolve / ingest / pipeline error) | 20/20 | **25/25 (100%)** |
| Mean overall confidence | 0.896 | **0.526** (median 0.509; 24/25 below 0.55) |
| Quarantine rate | — | **0/25** |
| Core-4 substance items intact (Items 1, 1A, 7, 8 all present & ≥500 chars) | ~95% | **17/25 (68%)** |
| Cost per filing (median / max) | $0.00 / — | **$0.024 / $0.060** (mean $0.028; only 1/25 was zero-cost L1+L2) |
| Wall-time per filing (p50) | ~5 s | **~36 s** (one filer stalled ~25 min on an EDGAR fetch back-off — tail latency is real) |
| Total cost, 25 filings | — | **$0.69** |

The headline: **the system never crashes and never returns nothing, but it also never reports high confidence on a real filing, and its quarantine net catches none of the real failures.** Both halves of that sentence matter.

The harness's own `pass_rate` field reads **0/25** — but that metric is mis-specified and should not be quoted. It requires *zero* required items below 500 chars, which flags Items 9–14 (Part III, legitimately incorporated-by-reference one-liners) as failures on almost every filer. The honest substance metric is **core-4 = 68%** (see [`tools/sweep_random_tickers.py:69`](../../tools/sweep_random_tickers.py#L69) for the over-strict definition).

## Failure mode breakdown

Diagnosing each short/missing core item (1 / 1A / 7 / 8) by hand split them into
two categories — **real extraction failures** vs **legitimate incorporation by
reference** — which the original `<500 char` metric could not tell apart:

| Filer | Core item short/missing | Verdict |
|---|---|---|
| C (Citi) | **Item 7 MISSING** + Item 1 (81 chars) | **Real failure** — no "Management's Discussion" heading anywhere; heading-detection collapse (only ~3 body headings found) |
| INTC | Item 1 (221) + Item 8 (73) | **Real failure** — non-canonical "Our Business" label; TOC at end of doc |
| WFC | Items 1A + 7 + 8 | **Real failure** — bank; 3 core items truncated, worst case after Citi |
| JPM | Item 7 (1147) + Item 8 (59) | **Real failure** — bank; MD&A + financials truncated |
| XOM | Item 7 (1572) | **Real failure** — MD&A mis-bounded |
| CVX | Item 7 (872) | **Real failure** — MD&A mis-bounded |
| PFE | Item 7 + Item 8 | **Real failure** — pharma |
| DIS | Item 8 (58) | **Real failure** — financials not captured anywhere in output |
| NVDA | Item 8 (58) | **Not a bug** — financials present under Item 15 (verified by "Consolidated Balance Sheets" markers); Item 8 legitimately points there |
| NFLX | Item 8 (58) | **Not a bug** — same as NVDA; financials captured under Item 15 |

So of the apparent "8/25 Item-8 failures", **2 (NVDA, NFLX) are correct
incorporation by reference, not truncation.** The genuinely-broken set is **8
filers** (Citi, INTC, WFC, JPM, XOM, CVX, PFE, DIS), and the dominant real
failure mode is **Item 7 (MD&A) — 5/8** followed by Item 8 financials. This
distinction is the whole reason the reliability fix below tracks *content
actually captured*, not just length.

## Reliability fix shipped (2026-06-04) — [ADR-007](../adr/ADR-007-structural-quarantine-gate.md)

The diagnosis above drove a fix. The problem was never that the pipeline
crashed — it was that it **silently returned broken extractions** because the
learned confidence score (~0.50 on every real filing) could not tell a good
extraction from one missing its MD&A. Re-running the identical sweep after the
fix:

| | Before (score-only gate) | After (structural gate) |
|---|---|---|
| Quarantine rate | **0/25** | **8/25 (32%)** |
| Real failures flagged | **0 / 8** | **8 / 8** |
| False quarantines (clean filing wrongly flagged) | — | **0 / 17** |
| Citi (MD&A missing) | silent pass | **quarantined**, reason `core item 7 (MD&A) missing` |
| NVDA / NFLX (Item 8 → Item 15) | counted as failures | **correctly passed** as incorporation by reference |

What changed (all deterministic, zero added LLM cost on the gate itself):

1. **Hard structural gate** ([`confidence.core_item_gate`](../../task2_10k_extractor/pipeline/confidence.py)) — any of Items 1/1A/7/8 missing or below its length floor quarantines the filing **regardless of the learned score**. The score is kept only as a lower floor. The 8 quarantined filers are exactly the 8 genuinely-broken ones; all 17 clean filers pass — zero false positives.
2. **Incorporation-by-reference labelling** ([`pipeline/recover.py`](../../task2_10k_extractor/pipeline/recover.py)) — Part III → proxy, and Item 8 → Item 15, are marked legitimately-short so the gate does not false-flag them. Critically, **Item 8 is only accepted as incorporated when the financial statements are actually captured somewhere in our output** (verified by content markers), so the label can never hide a real failure — that is what separates NVDA/NFLX (pass) from DIS (quarantine), all three with a 58-char Item 8.
3. **Deterministic gap-fill** for core items cleanly bracketed by trustworthy neighbours; refuses when the structure is unsound.
4. **L3 JSON salvage** ([`llm_gateway._coerce_json`](../../shared/llm_gateway.py)) — prompt B output truncated by `max_tokens` was previously discarded wholesale ("Unterminated string"); it is now repaired to recover the items extracted before the cutoff.

**What the fix does NOT do:** it does not improve raw extraction on the
heading-detection-collapse cases (Citi, INTC). Those filings still cannot be
fully extracted — but they are now **reliably refused** instead of silently
mis-returned. Fixing the extraction itself is a normalize-layer rework, tracked
as future work. The reliability property — *never silently return a 10-K with a
missing or garbled substance section* — is delivered.

Locked in by [`task2_10k_extractor/tests/test_recovery_gate.py`](../../task2_10k_extractor/tests/test_recovery_gate.py) (15 cases).

## Known failure modes (post-fix)

1. **Section openers using non-canonical labels** — INTC labels Item 1 body as "Our Business" not "Business"; Citi inlines Item 7 inside a sub-section instead of using the standard heading. The L1 picker has no anchor to land on. Mitigation would require either expanding the canonical-title list (high effort, low coverage) or adding an LLM-based text-scan fallback for items with zero non-TOC anchors (cost: ~$0.01 per filer per missing item, blocks on `pipeline/l3_llm.py` extension).

2. **TOC at the back of the document** — INTC's TOC is at chars 571K of a 575K document; the new gap-based picker handles this correctly for items with body anchors elsewhere, but items whose ONLY anchor is in the back-TOC degenerate to "1 line of TOC text."

3. **Items 10-14 (Part III) incorporated by reference** — these are SUPPOSED to be 1-2 line cross-references to a forthcoming proxy statement, not bugs. **Now handled:** [`recover.py`](../../task2_10k_extractor/pipeline/recover.py) detects the cover-page proxy note and flags these `incorporated_by_reference`, so they no longer count against confidence or the gate.

## Honest takeaways

- **The curated 95 % eval does not generalize.** On 25 untuned filers the substance-extraction rate (core-4 intact) is **68 %**, and mean confidence drops from 0.896 to **0.526**. The curated set was selected for — and the heading thresholds tuned against — filings the system handles cleanly. Real samples include filing styles the system was never fit to.
- **Confidence calibration does not transfer.** The Platt model was fit on the curated set (where scores spread 0.3–0.95). On real filings the score collapses to a ~0.51 cluster (median 0.509, 24/25 below 0.55) almost regardless of whether extraction succeeded. The number on the dashboard is therefore not trustworthy on out-of-distribution filers, which is exactly where a confidence signal would be most valuable.
- **Quarantine did NOT fire on the real failures (now FIXED — [ADR-007](../adr/ADR-007-structural-quarantine-gate.md)).** The score-only gate at `QUARANTINE_THRESHOLD = 0.45` let the real-world ~0.50 cluster through, so **0/25 were quarantined — including Citi with its entire MD&A (Item 7) missing.** The fix replaced reliance on the mis-calibrated score with a **hard structural gate**: any of Items 1/1A/7/8 missing or below floor quarantines regardless of score. Result on the same sweep: **8/8 real failures now flagged, 0/17 false positives.** A user pasting Citi now gets `core item 7 (MD&A) missing`, not silent garbage. The learned score is retained only as a lower floor; re-fitting it on out-of-distribution data remains future work but is no longer load-bearing for safety.
- **Section boundaries are the dominant failure mode**, exactly as the interviewer noted — once the legitimate incorporation cases (NVDA, NFLX) are excluded, the real failures concentrate on **Item 7 (MD&A, 5/8)** and Item 8 financials. Multiple filers have section openers, or financial-statement headings, that our detector misses.
- **The system is robust against crashing and against silent-nothing.** 25/25 resolved a ticker, fetched a live 10-K, and returned a populated item set. It never threw and never returned zero items. The failure mode is *quiet partial truncation*, not a crash — which is harder to detect and the reason the quarantine gap above matters.
- **Cost is low but not $0.** Real median is **$0.024/filing** (only 1/25 stayed on the free L1+L2 path; the rest triggered L3 self-consistency), max $0.060. The README's "median $0.00" is a curated-set artifact.

## What this changes in the docs

- README "Top-line numbers" table includes a "Real-world sweep" row alongside the curated eval row, plus the post-fix quarantine numbers.
- Capability matrix on `/dashboard` lists INTC and Citi under "Known failure modes" with the specific item IDs that fail and notes they are now quarantined (not silent).
- `task2_report.md` §5.5 "Curated eval ≠ production" carries the before/after reliability numbers.
- [ADR-007](../adr/ADR-007-structural-quarantine-gate.md) records the structural-gate decision.
