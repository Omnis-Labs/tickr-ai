"""Regression tests for the reliability layer added after the real-world sweep:

  * `confidence.core_item_gate` — the hard structural gate that quarantines
    any missing/truncated core substance item regardless of the learned score.
  * `recover.mark_incorporated_by_reference` — labels legitimately-short items
    (Part III → proxy, Item 8 → Item 15) so the gate does not false-flag them.
  * `recover.gap_fill_core_items` — reconstructs a cleanly-bracketed missing
    core item, and (critically) refuses to when the structure is unsound.
  * `llm_gateway._coerce_json` — salvages JSON truncated by max_tokens.

These lock in the behaviour that makes the pipeline trustworthy: it never
silently returns a 10-K with a missing/garbled substance section.
"""

from __future__ import annotations

from dataclasses import dataclass

from shared.schemas import ExtractedItem
from task2_10k_extractor.pipeline.confidence import (
    MIN_CHAR_LENGTH_HINTS,
    core_item_gate,
)
from task2_10k_extractor.pipeline.recover import (
    gap_fill_core_items,
    mark_incorporated_by_reference,
)
from shared.llm_gateway import _coerce_json


@dataclass
class _FakeIR:
    text: str

    @property
    def char_total(self) -> int:
        return len(self.text)


def _item(item_id: str, *, length: int, offset: int = 0, ibr: bool = False, notes: str | None = None) -> ExtractedItem:
    return ExtractedItem(
        item_id=item_id,
        title=item_id,
        content="x" * length,
        start_offset=offset,
        end_offset=offset + length,
        char_length=length,
        confidence=0.0,
        extraction_method="L1",
        incorporated_by_reference=ibr,
        notes=notes,
    )


def _all_core_healthy() -> list[ExtractedItem]:
    return [
        _item("1", length=MIN_CHAR_LENGTH_HINTS["1"] + 1, offset=0),
        _item("1A", length=MIN_CHAR_LENGTH_HINTS["1A"] + 1, offset=10_000),
        _item("7", length=MIN_CHAR_LENGTH_HINTS["7"] + 1, offset=30_000),
        _item("8", length=MIN_CHAR_LENGTH_HINTS["8"] + 1, offset=50_000),
    ]


# ---------------------------------------------------------------------------
# core_item_gate
# ---------------------------------------------------------------------------

def test_gate_passes_when_all_core_items_healthy():
    assert core_item_gate(_all_core_healthy()) == []


def test_gate_flags_missing_core_item():
    items = [it for it in _all_core_healthy() if it.item_id != "7"]
    reasons = core_item_gate(items)
    assert any("7" in r and "missing" in r for r in reasons)


def test_gate_flags_truncated_core_item():
    items = _all_core_healthy()
    items[-1] = _item("8", length=58, offset=50_000)  # the Citi/INTC TOC-stub pattern
    reasons = core_item_gate(items)
    assert any("8" in r and "truncated" in r for r in reasons)


def test_gate_does_not_flag_incorporated_by_reference():
    """An Item 8 filed under Item 15 is legitimately short — must not quarantine."""
    items = _all_core_healthy()
    items[-1] = _item("8", length=58, offset=50_000, ibr=True)
    assert core_item_gate(items) == []


def test_gate_flags_the_citi_failure_shape():
    """The exact shape from the sweep: only 1A real, 1/7/8 are TOC stubs."""
    items = [
        _item("1", length=81, offset=350_941),     # TOC stub
        _item("1A", length=363_467, offset=506_689),  # real body
        _item("8", length=672_194, offset=870_156),   # real body
        # Item 7 entirely absent
    ]
    reasons = core_item_gate(items)
    assert any("7" in r for r in reasons)   # MD&A missing
    assert any("1" in r for r in reasons)   # Business truncated


# ---------------------------------------------------------------------------
# incorporation-by-reference labelling
# ---------------------------------------------------------------------------

def test_part_iii_marked_when_proxy_phrase_present():
    ir = _FakeIR(
        "Documents Incorporated by Reference: Portions of the registrant's "
        "Proxy Statement for the annual meeting are incorporated herein."
    )
    items = [_item("11", length=120, offset=1000)]  # short Part III item
    n = mark_incorporated_by_reference(items, ir)
    assert n == 1 and items[0].incorporated_by_reference is True


def test_part_iii_not_marked_without_proxy_phrase():
    ir = _FakeIR("This filing contains no such cover note.")
    items = [_item("11", length=120, offset=1000)]
    assert mark_incorporated_by_reference(items, ir) == 0
    assert items[0].incorporated_by_reference is False


def test_long_part_iii_item_not_marked():
    """A fully-extracted Part III item is real content, not a cross-reference."""
    ir = _FakeIR("Portions of the Proxy Statement are incorporated by reference.")
    items = [_item("11", length=5_000, offset=1000)]
    assert mark_incorporated_by_reference(items, ir) == 0


def test_item8_marked_when_reference_and_financials_captured():
    """Reference phrase present AND the statements really were captured under
    another item (e.g. Item 15) → legitimately short Item 8."""
    ir = _FakeIR(
        "The consolidated financial statements are filed as part of this "
        "report and listed under Item 15."
    )
    financials = "...\n" + "Consolidated Balance Sheets\n" + ("n" * 10_000)
    items = [
        _item("8", length=70, offset=1000),
        ExtractedItem(
            item_id="15", title="Exhibits", content=financials,
            start_offset=2000, end_offset=2000 + len(financials),
            char_length=len(financials), confidence=0.0, extraction_method="L1",
        ),
    ]
    assert mark_incorporated_by_reference(items, ir) == 1
    assert items[0].incorporated_by_reference is True


def test_item8_NOT_marked_when_financials_absent():
    """Reference phrase present but the statements were NOT captured anywhere —
    this is a real extraction failure and must NOT be hidden as incorporation."""
    ir = _FakeIR(
        "The consolidated financial statements are filed as part of this "
        "report and listed under Item 15."
    )
    items = [_item("8", length=70, offset=1000)]  # nothing else; no financials body
    assert mark_incorporated_by_reference(items, ir) == 0
    assert items[0].incorporated_by_reference is False


# ---------------------------------------------------------------------------
# gap-fill
# ---------------------------------------------------------------------------

def test_gap_fill_recovers_cleanly_bracketed_item():
    """Item 7 missing, bracketed by trustworthy Item 6 and Item 8 — recover."""
    ir = _FakeIR("y" * 100_000)
    items = [
        _item("6", length=2_000, offset=10_000),    # trustworthy body, ends 12_000
        _item("8", length=20_000, offset=40_000),   # trustworthy body
        _item("1", length=3_000, offset=1_000),
        _item("1A", length=6_000, offset=4_000),
    ]
    # Item 7 absent; should be reconstructed as span [12_000, 40_000)
    n = gap_fill_core_items(items, ir)
    assert n == 1
    seven = next(it for it in items if it.item_id == "7")
    assert seven.start_offset == 12_000 and seven.end_offset == 40_000
    assert seven.extraction_method == "L2"


def test_gap_fill_refuses_when_span_implausibly_large():
    """If the only neighbours bracket >60% of the doc, the structure is
    unsound — refuse to manufacture content, let the gate quarantine."""
    ir = _FakeIR("y" * 100_000)
    items = [
        _item("1A", length=2_000, offset=1_000),    # ends 3_000
        _item("8", length=5_000, offset=80_000),    # 77% of doc between them
    ]
    # Item 7 absent; span [3_000, 80_000) = 77% of doc → refuse
    assert gap_fill_core_items(items, ir) == 0
    assert not any(it.item_id == "7" for it in items)


def test_gap_fill_refuses_when_other_anchor_inside_span():
    ir = _FakeIR("y" * 100_000)
    items = [
        _item("6", length=2_000, offset=10_000),    # ends 12_000
        _item("8", length=5_000, offset=40_000),
        _item("7A", length=300, offset=25_000),     # sits inside [12_000,40_000)
    ]
    # Item 7 absent but 7A anchor is inside the candidate span → ambiguous → refuse
    assert gap_fill_core_items(items, ir) == 0


# ---------------------------------------------------------------------------
# JSON salvage
# ---------------------------------------------------------------------------

def test_coerce_json_salvages_truncated_items_array():
    truncated = '{"items": [{"item_id": "7", "body_start_offset": 100}, {"item_id": "8", "body_sta'
    out = _coerce_json(truncated)
    assert out["items"][0]["item_id"] == "7"


def test_coerce_json_strips_markdown_fence():
    assert _coerce_json('```json\n{"found": true}\n```')["found"] is True
