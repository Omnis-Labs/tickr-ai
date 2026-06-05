"""L2 — structural extractor.

L1 catches items whose body header is a proper heading element. It misses
items where the header is visually styled but not in our heading-tag set
(e.g. some old filings use plain `<p>` with custom font-size).

L2 fills those gaps by leveraging structural signals the parser captured but
L1 ignored:

  1. **TOC reverse-lookup** — most modern 10-Ks have a Table of Contents where
     each `<a href="#item7a">Item 7A. MD&A</a>` points at an in-page anchor.
     The normalizer records both the TOC links and the anchor targets. For
     each item L1 missed, we look up its TOC anchor's target and slice the
     body from there.

  2. **Per-item length sanity** — L1 sometimes picks a body anchor that's
     actually a stub ("Item 6. [Reserved]") followed immediately by a section
     header for the NEXT item. If an L1 item is suspiciously short AND the
     same item has a TOC anchor target pointing somewhere different, L2 swaps
     in the TOC target.

L2 is the cheapest layer above L1 (still zero LLM cost) — pure structural
inference over the IR.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from shared.logging import get_logger
from shared.schemas import TEN_K_ITEM_IDS, ExtractedItem

from task2_10k_extractor.pipeline.l1_anchor import (
    ITEM_CANONICAL_TITLE,
    _normalize_id,
)
from task2_10k_extractor.pipeline.normalize import NormalizedFiling

logger = get_logger(__name__)

# Item 5 has a notoriously long canonical title — most filings spell out
# only a fragment. Same for items 7, 8, etc. We match on item id + an
# optional title prefix.
_TOC_ITEM_RE = re.compile(
    r"^\s*item\s+(?P<id>\d+[A-Z]?)\.?\s*(?P<rest>.*)?$",
    re.IGNORECASE,
)


@dataclass
class TocToBodyMapping:
    item_id: str
    body_offset: int
    via_anchor: str           # the href we followed
    toc_link_text: str        # the TOC visible text


def _build_toc_index(ir: NormalizedFiling) -> dict[str, TocToBodyMapping]:
    """For each item_id in the TOC, return where the body section lives.

    Walks the captured TOC anchors, normalizes the item id, and looks up the
    matching anchor target. Items absent from the TOC OR with no resolvable
    target are omitted from the result.
    """
    target_by_id: dict[str, int] = {
        t.target_id: t.char_offset for t in ir.anchor_targets
    }
    # SEC filings sometimes prefix anchor IDs (e.g. "item1a", "Item_1A").
    # Build a case-insensitive lookup table.
    target_ci: dict[str, int] = {k.lower(): v for k, v in target_by_id.items()}

    mapping: dict[str, TocToBodyMapping] = {}
    for toc in ir.toc_anchors:
        m = _TOC_ITEM_RE.match(toc.link_text)
        if not m:
            continue
        item_id = _normalize_id(m.group("id"))
        if item_id not in TEN_K_ITEM_IDS:
            continue
        # Try a few common anchor naming conventions
        candidates = [
            toc.target_anchor,
            toc.target_anchor.lower(),
            f"item{item_id}".lower(),
            f"item_{item_id}".lower(),
            f"item{item_id.lower()}",
        ]
        body_offset: int | None = None
        which: str | None = None
        for cand in candidates:
            if cand in target_by_id:
                body_offset = target_by_id[cand]
                which = cand
                break
            if cand.lower() in target_ci:
                body_offset = target_ci[cand.lower()]
                which = cand
                break
        if body_offset is None:
            continue
        # First-wins for each item_id (TOC usually has each item exactly once)
        if item_id not in mapping:
            mapping[item_id] = TocToBodyMapping(
                item_id=item_id,
                body_offset=body_offset,
                via_anchor=which or toc.target_anchor,
                toc_link_text=toc.link_text,
            )
    return mapping


def _slice_content(text: str, start: int, end: int) -> str:
    raw = text[start:end]
    first_nl = raw.find("\n")
    if first_nl > 0:
        raw = raw[first_nl + 1:]
    return raw.strip()


def extract_l2(
    *, l1_items: list[ExtractedItem], ir: NormalizedFiling
) -> list[ExtractedItem]:
    """Augment L1's output with TOC-reverse-lookup recoveries.

    Returns a new item list. For each item:
      - if L1 found it AND its char_length is plausible → keep L1's record
      - if L1 missed it AND TOC has a target → produce an L2 record
      - if L1 found a stub (suspiciously short) AND TOC target points
        elsewhere → swap to L2's wider boundary
    """
    if not ir.toc_anchors or not ir.anchor_targets:
        return l1_items  # no structural signal to exploit

    mapping = _build_toc_index(ir)
    if not mapping:
        return l1_items

    # Reindex L1 by item_id for fast lookup; preserve doc order via offsets
    l1_by_id: dict[str, ExtractedItem] = {it.item_id: it for it in l1_items}

    # Build the merged set of (item_id, offset) using TOC-or-L1
    sources: list[tuple[str, int, str]] = []  # (id, offset, source)
    for iid in TEN_K_ITEM_IDS:
        l1_item = l1_by_id.get(iid)
        toc_hit = mapping.get(iid)
        if l1_item is None and toc_hit is None:
            continue
        if l1_item is None:
            sources.append((iid, toc_hit.body_offset, "L2"))
            continue
        if toc_hit is None:
            sources.append((iid, l1_item.start_offset, "L1"))
            continue
        # Both available — pick by plausibility:
        #   * If L1's item is < 200 chars but TOC target is significantly
        #     further from previous item OR previous L1 is non-stub, prefer TOC.
        #   * Otherwise keep L1 (it had the heading text, more reliable).
        l1_short = l1_item.char_length < 300
        offsets_differ = abs(l1_item.start_offset - toc_hit.body_offset) > 200
        if l1_short and offsets_differ:
            sources.append((iid, toc_hit.body_offset, "L2"))
        else:
            sources.append((iid, l1_item.start_offset, "L1"))

    if not sources:
        return l1_items

    # Sort by offset and slice between consecutive anchors
    sources.sort(key=lambda s: s[1])
    items: list[ExtractedItem] = []
    for i, (iid, off, src) in enumerate(sources):
        end = sources[i + 1][1] if i + 1 < len(sources) else ir.char_total
        if src == "L1" and iid in l1_by_id:
            # Reuse the L1 ExtractedItem but recompute the end boundary
            l1_item = l1_by_id[iid]
            new_end = end
            content = _slice_content(ir.text, l1_item.start_offset, new_end)
            items.append(
                ExtractedItem(
                    item_id=iid,
                    title=l1_item.title,
                    content=content,
                    start_offset=l1_item.start_offset,
                    end_offset=new_end,
                    char_length=new_end - l1_item.start_offset,
                    confidence=0.0,  # rescored later
                    extraction_method="L1",
                    notes=l1_item.notes,
                )
            )
        else:
            content = _slice_content(ir.text, off, end)
            items.append(
                ExtractedItem(
                    item_id=iid,
                    title=ITEM_CANONICAL_TITLE.get(iid, ""),
                    content=content,
                    start_offset=off,
                    end_offset=end,
                    char_length=end - off,
                    confidence=0.0,
                    extraction_method="L2",
                    notes="recovered via TOC anchor reverse-lookup",
                )
            )

    if any(it.extraction_method == "L2" for it in items):
        logger.info(
            "l2_recovered_items",
            n=sum(1 for it in items if it.extraction_method == "L2"),
        )
    return items
