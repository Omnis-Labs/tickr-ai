"""Core-item recovery + incorporation-by-reference labelling.

Runs after L1/L2/L3, before final scoring. Two deterministic (zero-LLM)
passes that make the extraction both more correct and more honest:

  1. `mark_incorporated_by_reference` — some required items are *supposed* to
     be short because their substance is filed elsewhere:
       * Part III (Items 10–14) is almost always incorporated by reference to
         the registrant's definitive proxy statement (the cover page carries
         the standard "Documents Incorporated by Reference … Proxy Statement"
         note). A short Item 11/12/… is therefore correct, not truncated.
       * Item 8 (Financial Statements) is occasionally filed under Item 15 /
         as an exhibit (e.g. MSFT FY2015). When an explicit reference phrase
         is present we mark it rather than calling it a failure.
     Marking sets `incorporated_by_reference=True`, which the confidence gate
     (`confidence.core_item_gate`) treats as legitimately-short.

  2. `gap_fill_core_items` — when a core substance item (1/1A/7/8) is missing
     or truncated but is cleanly bounded by two trustworthy body anchors in
     correct canonical order, reconstruct its content as the span between
     them. Conservative by design: only fires when the bracketing structure
     is sound, so it never manufactures content over a mis-anchored region
     (those stay quarantined by the gate instead of being silently "fixed").

Why deterministic and not LLM: the real-world sweep showed the failures are
mis-*located* sections, not missing text. Where the structure is sound these
two passes recover it for free; where it is broken (Citi/INTC heading-
detection collapse) no cheap pass can recover it correctly, so we let the
gate quarantine it rather than guess. See docs/analysis/real_world_sweep.md.
"""

from __future__ import annotations

import re

from shared.logging import get_logger
from shared.schemas import TEN_K_ITEM_IDS, ExtractedItem

from task2_10k_extractor.pipeline.confidence import (
    CORE_ITEMS,
    MIN_CHAR_LENGTH_HINTS,
    OPTIONAL_ITEMS,
)
from task2_10k_extractor.pipeline.l1_anchor import ITEM_CANONICAL_TITLE
from task2_10k_extractor.pipeline.normalize import NormalizedFiling

logger = get_logger(__name__)

PART_III_ITEMS = ("10", "11", "12", "13", "14")

# Cover-page boilerplate present in essentially every 10-K that defers Part III
# to the proxy. Conservative: we only act on it for *short* Part III items.
_PROXY_INCORP_RE = re.compile(
    r"incorporated[^.\n]{0,40}by\s+reference[^.\n]{0,80}"
    r"(proxy\s+statement|definitive\s+proxy)",
    re.IGNORECASE,
)

# Explicit Item-8-filed-elsewhere phrasing (e.g. pre-iXBRL filers that file the
# financial statements under Item 15). Deliberately strict — a false positive
# here would hide a real truncation, so we require the financial-statements
# noun adjacent to an Item-15 / Part-IV / exhibit reference.
_ITEM8_INCORP_RE = re.compile(
    r"financial\s+statements[^.\n]{0,160}"
    r"(incorporated\s+by\s+reference|filed\s+as\s+(a\s+)?part\s+of|"
    r"(set\s+forth|included|listed|appear)[^.\n]{0,40}(item\s*15|part\s*iv|exhibit))",
    re.IGNORECASE,
)

# Actual financial-statement content markers. Used to confirm the statements
# really are present somewhere in our extracted output before we accept that a
# short Item 8 is "incorporated by reference" rather than a failed extraction.
# Without this guard, the Item-15 exhibit-index boilerplate ("the following
# financial statements are filed as part of this report") would let us mark
# Item 8 incorporated even when we never actually captured the statements —
# hiding a real failure, the opposite of the reliability we want.
_FIN_STMT_MARKER_RE = re.compile(
    r"consolidated\s+(balance\s+sheets?|statements?\s+of\s+"
    r"(operations|income|earnings|cash\s+flows|financial\s+position|stockholders))",
    re.IGNORECASE,
)

# A Part III item below this is treated as a cross-reference, not a body.
_PART_III_SHORT = 1_500


def _financials_captured(items: list[ExtractedItem]) -> bool:
    """True if the consolidated financial statements appear in some sizeable
    extracted item (typically Item 15). Gate for Item-8 incorporation."""
    return any(
        it.char_length > 5_000 and _FIN_STMT_MARKER_RE.search(it.content)
        for it in items
    )


def mark_incorporated_by_reference(
    items: list[ExtractedItem], ir: NormalizedFiling
) -> int:
    """Flag items whose short body is legitimate (content filed elsewhere).

    Returns the number of items newly flagged. Mutates `items` in place.
    """
    text = ir.text
    flagged = 0

    proxy_present = bool(_PROXY_INCORP_RE.search(text[:20_000]) or _PROXY_INCORP_RE.search(text))
    # Item 8 is only legitimately short if BOTH an explicit reference phrase is
    # present AND the statements are actually captured elsewhere in our output.
    item8_incorp = bool(_ITEM8_INCORP_RE.search(text)) and _financials_captured(items)

    for it in items:
        if it.incorporated_by_reference:
            continue
        legit = False
        if it.item_id in PART_III_ITEMS and proxy_present and it.char_length < _PART_III_SHORT:
            legit = True
            reason = "incorporated by reference to the proxy statement"
        elif it.item_id == "8" and item8_incorp and it.char_length < MIN_CHAR_LENGTH_HINTS["8"]:
            legit = True
            reason = "financial statements presented under Item 15 / as an exhibit"
        if legit:
            it.incorporated_by_reference = True
            it.notes = "; ".join(filter(None, [it.notes, f"incorporated by reference — {reason}"]))
            flagged += 1

    if flagged:
        logger.info("incorporation_marked", count=flagged)
    return flagged


def _is_trustworthy_body(it: ExtractedItem) -> bool:
    """A body anchor we can lean on as a gap-fill boundary: not a TOC stub,
    and long enough to plausibly be a real section."""
    if it.notes and "TOC" in it.notes:
        return False
    return it.char_length >= 1_000


def gap_fill_core_items(items: list[ExtractedItem], ir: NormalizedFiling) -> int:
    """Reconstruct a missing/truncated core item from its trustworthy
    canonical neighbours. Returns number of items recovered. Mutates `items`.

    Only fires when the target is cleanly bracketed: an immediate canonical
    predecessor and successor that are both trustworthy body anchors in the
    right order, with no other extracted item's anchor falling inside the
    span (so the recovered span belongs to exactly one item).
    """
    canon_idx = {iid: i for i, iid in enumerate(TEN_K_ITEM_IDS)}
    by_id = {it.item_id: it for it in items}
    # All anchors sorted by document position, for the "nothing else inside" test.
    offsets_sorted = sorted((it.start_offset, it.item_id) for it in items)
    recovered = 0

    for iid in CORE_ITEMS:
        it = by_id.get(iid)
        floor = MIN_CHAR_LENGTH_HINTS.get(iid, 1_000)
        if it is not None and it.char_length >= floor:
            continue  # already fine
        if it is not None and it.incorporated_by_reference:
            continue

        ci = canon_idx[iid]
        # nearest trustworthy present predecessor / successor in canonical order
        pred = max(
            (o for o in items if _is_trustworthy_body(o) and canon_idx.get(o.item_id, -1) < ci),
            key=lambda o: canon_idx[o.item_id],
            default=None,
        )
        succ = min(
            (o for o in items if _is_trustworthy_body(o) and canon_idx.get(o.item_id, 99) > ci),
            key=lambda o: canon_idx[o.item_id],
            default=None,
        )
        if pred is None or succ is None:
            continue
        span_start, span_end = pred.end_offset, succ.start_offset
        if span_end - span_start < floor:
            continue
        if span_end - span_start > 0.6 * ir.char_total:
            continue  # implausibly large — structure is unsound, let the gate quarantine
        # No other extracted anchor may sit strictly inside the span.
        if any(span_start < off < span_end and oid not in (iid, pred.item_id, succ.item_id)
               for off, oid in offsets_sorted):
            continue

        content = ir.text[span_start:span_end].strip()
        title = ITEM_CANONICAL_TITLE.get(iid, iid)
        note = f"recovered by gap-fill between Item {pred.item_id} and Item {succ.item_id}"
        new_item = ExtractedItem(
            item_id=iid,
            title=title,
            content=content,
            start_offset=span_start,
            end_offset=span_end,
            char_length=span_end - span_start,
            confidence=0.0,
            extraction_method="L2",  # deterministic structural reconstruction
            notes="; ".join(filter(None, [it.notes if it else None, note])),
        )
        if it is None:
            items.append(new_item)
        else:
            items[items.index(it)] = new_item
        by_id[iid] = new_item
        recovered += 1

    if recovered:
        items.sort(key=lambda x: x.start_offset)
        logger.info("gap_fill_recovered", count=recovered)
    return recovered


def recover_core_items(items: list[ExtractedItem], ir: NormalizedFiling) -> list[ExtractedItem]:
    """Top-level recovery entry point. Idempotent, deterministic, zero LLM."""
    mark_incorporated_by_reference(items, ir)
    gap_fill_core_items(items, ir)
    # Re-mark in case gap-fill produced a still-short item that is actually
    # an incorporation case (rare, but keeps the two passes order-independent).
    mark_incorporated_by_reference(items, ir)
    return items
