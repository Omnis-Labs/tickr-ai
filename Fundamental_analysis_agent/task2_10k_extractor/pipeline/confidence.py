"""Confidence scoring + quarantine policy.

Per PLAN.md §3.5 the production confidence model is a calibrated logistic
regression (Platt-scaled) over four signals:

  w1 * anchor_coverage          (L1 items found / 17 canonical)
  w2 * boundary_agreement       (L3 self-consistency IoU)
  w3 * structural_invariant     (item order valid, no zero-length, total
                                  coverage of doc ≥ X)
  w4 * cross_year_consistency   (z-score of item length vs prior years)

For the L1-only MVP we compute the three signals we already have (1, 3) and
a stub for the others, so the field is present and meaningful but documented
as un-calibrated. The dashboard prints "uncalibrated" so reviewers don't
overinterpret.
"""

from __future__ import annotations

from shared.logging import get_logger
from shared.schemas import TEN_K_ITEM_IDS, ExtractedItem

logger = get_logger(__name__)

# Items SEC often allows to be omitted in practice (e.g. mining-specific item 4
# is N/A for most non-extractive filers). Missing these does not penalise.
OPTIONAL_ITEMS = {"1B", "1C", "4", "6", "9B", "9C", "16"}

REQUIRED_ITEMS = [iid for iid in TEN_K_ITEM_IDS if iid not in OPTIONAL_ITEMS]

# Items expected to be moderately long. Below these char counts, content is
# probably truncated or mis-bounded.
MIN_CHAR_LENGTH_HINTS = {
    "1": 2_000,
    "1A": 5_000,
    "7": 5_000,
    "8": 2_000,
}

# The four substance items of a 10-K: Business, Risk Factors, MD&A, and
# Financial Statements. If any of these is missing or truncated, the
# extraction is not usable regardless of what the (out-of-distribution-
# unreliable) learned confidence score says. The hard gate below enforces
# this independently of the score — see `core_item_gate`.
CORE_ITEMS = ("1", "1A", "7", "8")

_CORE_TITLE = {
    "1": "Business",
    "1A": "Risk Factors",
    "7": "MD&A",
    "8": "Financial Statements",
}


def core_item_gate(items: list[ExtractedItem]) -> list[str]:
    """Deterministic structural gate over the four substance items.

    Returns a list of human-readable failure reasons (empty == pass). The
    orchestrator force-quarantines on any reason here, regardless of the
    learned confidence score. This exists because the real-world sweep
    (docs/analysis/real_world_sweep.md) showed the learned score collapses to
    a ~0.50 cluster on out-of-distribution filers and sits *just above* the
    0.45 quarantine threshold — so it caught none of the real failures,
    including Citi with its entire MD&A missing. A hard structural gate is
    not fooled by a mis-calibrated score.

    An item flagged `incorporated_by_reference` (e.g. Item 8 financials filed
    under Item 15, Part III deferred to the proxy) is CORRECT to be short and
    does not trip the gate.
    """
    by_id = {it.item_id: it for it in items}
    reasons: list[str] = []
    for iid in CORE_ITEMS:
        it = by_id.get(iid)
        title = _CORE_TITLE[iid]
        if it is None:
            reasons.append(f"core item {iid} ({title}) missing")
            continue
        if it.incorporated_by_reference:
            continue
        floor = MIN_CHAR_LENGTH_HINTS.get(iid, 1_000)
        if it.char_length < floor:
            reasons.append(
                f"core item {iid} ({title}) truncated — {it.char_length} < {floor} chars"
            )
    return reasons


def score_items(
    items: list[ExtractedItem], *, total_chars: int
) -> tuple[list[ExtractedItem], float, list[str]]:
    """Mutate items in-place with calibrated-ish confidence; return overall + quarantine reasons."""
    found_ids = [it.item_id for it in items]

    anchor_coverage = (
        len([i for i in REQUIRED_ITEMS if i in found_ids]) / max(1, len(REQUIRED_ITEMS))
    )

    # Structural invariants
    structural_score = 1.0
    quarantine_reasons: list[str] = []

    # Invariant: item ids should appear in document in the SEC-defined order
    # (allowing skips). Find the canonical position of each found id; positions
    # must be strictly increasing.
    canonical_pos = {iid: i for i, iid in enumerate(TEN_K_ITEM_IDS)}
    last = -1
    out_of_order = 0
    for iid in found_ids:
        p = canonical_pos.get(iid)
        if p is None:
            continue
        if p <= last:
            out_of_order += 1
        last = p
    if out_of_order:
        structural_score -= 0.2 * min(1.0, out_of_order / 5)
        quarantine_reasons.append(f"{out_of_order} item(s) out of canonical order")

    # Invariant: covered text length should be ≥ 60% of the document
    covered = sum(it.char_length for it in items)
    coverage_ratio = covered / max(1, total_chars)
    if coverage_ratio < 0.5:
        structural_score -= 0.3
        quarantine_reasons.append(
            f"text coverage {coverage_ratio:.0%} below 50% — items likely truncated"
        )

    # Below-floor count — REQUIRED items only. Optional items (1B/6/9B/9C/16)
    # are commonly empty by design (e.g. Item 6 [Reserved]), so penalising
    # them creates false-positive quarantines on completely valid filings.
    too_short = 0
    for it in items:
        if it.item_id in OPTIONAL_ITEMS:
            continue
        if it.incorporated_by_reference:
            continue  # legitimately short — content lives elsewhere
        floor = MIN_CHAR_LENGTH_HINTS.get(it.item_id, 0)
        if floor and it.char_length < floor:
            too_short += 1
    if too_short:
        structural_score -= 0.1 * min(1.0, too_short / max(1, len(REQUIRED_ITEMS)))
        quarantine_reasons.append(
            f"{too_short} required item(s) below expected min length"
        )

    structural_score = max(0.0, structural_score)
    base = 0.5 * anchor_coverage + 0.5 * structural_score

    # Per-item adjustments.
    for it in items:
        c = base
        is_optional = it.item_id in OPTIONAL_ITEMS
        if it.notes and "TOC" in it.notes:
            c *= 0.3
        # "empty content" is only fatal for REQUIRED items. For optional
        # items an empty body is the norm and should not zero out confidence.
        if it.notes and "empty content" in it.notes and not is_optional:
            c *= 0.1
        floor = MIN_CHAR_LENGTH_HINTS.get(it.item_id, 0)
        if floor and it.char_length < floor and not is_optional and not it.incorporated_by_reference:
            c *= max(0.4, it.char_length / floor)
        # L2-recovered items get a small trust discount vs. L1 (no explicit
        # heading text, derived from anchor href only).
        if it.extraction_method == "L2":
            c *= 0.85
        it.confidence = round(min(1.0, max(0.0, c)), 4)

    # Overall: 25th percentile over REQUIRED items. Robust to a single bad
    # item (one [Reserved] section won't crash a job to 0) while still
    # surfacing systemic problems (>25% of items bad → low overall).
    required_confs = sorted(
        it.confidence for it in items if it.item_id not in OPTIONAL_ITEMS
    )
    if required_confs:
        idx = max(0, int(0.25 * (len(required_confs) - 1)))
        overall = required_confs[idx]
    else:
        overall = 0.0

    if anchor_coverage < 0.7:
        quarantine_reasons.append(
            f"anchor coverage {anchor_coverage:.0%} below 70% — many items missing"
        )
    if not items:
        quarantine_reasons.append("no items extracted")

    return items, overall, quarantine_reasons


QUARANTINE_THRESHOLD = 0.45
