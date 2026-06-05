"""L1 — anchor-based item extractor.

Goal: zero LLM cost. Find Item boundaries in the normalized text using
deterministic regex + structural heuristics. Compute confidence from
observable invariants. Hand off to L2/L3 only when confidence is low.

Approach:
  1. Scan all headings for "Item X[.] <Title>" patterns.
  2. Filter out TOC-region duplicates (we want body anchors, not the TOC).
  3. Build a sequence of (item_id, anchor_offset).
  4. For each anchor, the item's `content` = text between this anchor and
     the next anchor.
  5. Validate against SEC's expected item set and ordering.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from shared.logging import get_logger
from shared.schemas import TEN_K_ITEM_IDS, ExtractedItem

from task2_10k_extractor.pipeline.normalize import HeadingCandidate, NormalizedFiling

logger = get_logger(__name__)


# Canonical titles per SEC Form 10-K (2024). Used for title back-fill and
# weak validation. Multiple aliases allowed because filings vary slightly.
ITEM_CANONICAL_TITLE: dict[str, str] = {
    "1": "Business",
    "1A": "Risk Factors",
    "1B": "Unresolved Staff Comments",
    "1C": "Cybersecurity",
    "2": "Properties",
    "3": "Legal Proceedings",
    "4": "Mine Safety Disclosures",
    "5": "Market for Registrant's Common Equity, Related Stockholder Matters and Issuer Purchases of Equity Securities",
    "6": "[Reserved]",
    "7": "Management's Discussion and Analysis of Financial Condition and Results of Operations",
    "7A": "Quantitative and Qualitative Disclosures About Market Risk",
    "8": "Financial Statements and Supplementary Data",
    "9": "Changes in and Disagreements with Accountants on Accounting and Financial Disclosure",
    "9A": "Controls and Procedures",
    "9B": "Other Information",
    "9C": "Disclosure Regarding Foreign Jurisdictions that Prevent Inspections",
    "10": "Directors, Executive Officers and Corporate Governance",
    "11": "Executive Compensation",
    "12": "Security Ownership of Certain Beneficial Owners and Management and Related Stockholder Matters",
    "13": "Certain Relationships and Related Transactions, and Director Independence",
    "14": "Principal Accountant Fees and Services",
    "15": "Exhibits, Financial Statement Schedules",
    "16": "Form 10-K Summary",
}


# Matches: "Item 1.", "ITEM 1A", "Item 7A. Management's Discussion...", "Item 7A — MD&A"
# `\s` in Python 3 is Unicode-aware, so non-breaking space (\xa0) and friends
# in filings like Citi's are handled without an explicit special case.
_ITEM_HEADING_RE = re.compile(
    r"""
    ^\s*
    item\s+
    (?P<id>\d+[A-Z]?)        # e.g. 1, 1A, 9B, 16
    \s*[.\-:–—]?     # optional separator (dot, dash, em-dash)
    \s*
    (?P<title>[^\n]{0,200})?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

# ---------------------------------------------------------------------------
# Title-based heading detection — fallback for filers (Intel, Citi, etc.) who
# put SEC canonical titles ("Risk Factors", "Business") in their body
# headings without the leading "Item N." text. Diagnosed via INTC FY2025 +
# Citi FY2025: both filings have 0 instances of `Item N` in the body — only
# in TOC at end / middle of document. Without this fallback, L1 only ever
# matches TOC entries and the whole pipeline quarantines with "TOC anchor
# only — body may be missing" notes on every item.
#
# Two match strategies:
#   * EXACT: whole heading text equals one of these (modulo trailing
#     punctuation) — used for short canonical titles where a prefix match
#     would over-fire on unrelated paragraphs.
#   * PREFIX: heading text starts with one of these — used for long
#     canonical titles where the filer may have shortened the suffix.
EXACT_TITLE_TO_ITEM: dict[str, str] = {
    "business": "1",
    "risk factors": "1A",
    "unresolved staff comments": "1B",
    "cybersecurity": "1C",
    "properties": "2",
    "legal proceedings": "3",
    "mine safety disclosures": "4",
    "reserved": "6",
    "[reserved]": "6",
    "controls and procedures": "9A",
    "other information": "9B",
    "executive compensation": "11",
    "form 10-k summary": "16",
}

PREFIX_TITLE_TO_ITEM: list[tuple[str, str]] = [
    # Longest first so prefix matching is greedy in the right direction.
    ("management's discussion and analysis", "7"),
    ("managements discussion and analysis", "7"),
    ("management discussion and analysis", "7"),
    ("quantitative and qualitative disclosures", "7A"),
    ("financial statements and supplementary", "8"),
    ("consolidated financial statements", "8"),
    ("changes in and disagreements with accountants", "9"),
    ("changes in and disagreements with the accountants", "9"),
    ("disclosure regarding foreign jurisdictions", "9C"),
    ("directors, executive officers and corporate governance", "10"),
    ("directors, executive officers", "10"),
    ("security ownership of certain beneficial owners", "12"),
    ("certain relationships and related transactions", "13"),
    ("principal accountant fees", "14"),
    ("exhibits, financial statement schedules", "15"),
    ("exhibits and financial statement schedules", "15"),
    ("market for registrant", "5"),
    ("market for the registrant", "5"),
]

_TRAIL_PUNCT_RE = re.compile(r"[\.\:\;\,\—\–\-\s]+$")


def _normalize_title_for_match(text: str) -> str:
    """Lower-case, strip leading/trailing punctuation, collapse whitespace."""
    s = (text or "").lower().strip()
    s = _TRAIL_PUNCT_RE.sub("", s)
    s = re.sub(r"\s+", " ", s)
    return s


def _match_title_to_item(heading_text: str) -> str | None:
    """Return item_id if heading text matches a canonical SEC title (exactly
    or via a known multi-word prefix). Else None."""
    if not heading_text:
        return None
    normalized = _normalize_title_for_match(heading_text)
    if normalized in EXACT_TITLE_TO_ITEM:
        return EXACT_TITLE_TO_ITEM[normalized]
    for prefix, item_id in PREFIX_TITLE_TO_ITEM:
        if normalized.startswith(prefix):
            return item_id
    return None


@dataclass
class _Anchor:
    item_id: str
    char_offset: int
    raw_title: str
    is_toc: bool


def _normalize_id(raw: str) -> str:
    """Item id normalization: '01' → '1', '1a' → '1A'."""
    s = raw.strip().upper()
    if re.fullmatch(r"\d+[A-Z]?", s):
        digits = re.match(r"\d+", s).group(0)
        suffix = s[len(digits):]
        return str(int(digits)) + suffix
    return s


def _scan_anchors(ir: NormalizedFiling) -> list[_Anchor]:
    """Scan heading candidates for either:

    (a) "Item N." text  (the original ID-based regex), OR
    (b) The canonical SEC title of an item, with no "Item N." prefix
        (Intel, Citi, and similar filers' body-section style).

    Strategy (b) is critical: ~25% of S&P 500 filers we sampled put only
    the canonical title in the body heading and reserve "Item N." text
    for the TOC. Without (b), L1 only ever finds TOC entries and the
    whole pipeline quarantines.
    """
    anchors: list[_Anchor] = []
    for h in ir.headings:
        # (a) ID-based match — fast path for filers that include "Item N." in body
        m = _ITEM_HEADING_RE.match(h.text)
        if m:
            item_id = _normalize_id(m.group("id"))
            if item_id in TEN_K_ITEM_IDS:
                anchors.append(
                    _Anchor(
                        item_id=item_id,
                        char_offset=h.char_offset,
                        raw_title=(m.group("title") or "").strip(),
                        is_toc=h.is_table_of_contents,
                    )
                )
                continue

        # (b) Title-based match — for filers (INTC, Citi, similar) whose
        # body headings are the canonical SEC title alone
        item_id = _match_title_to_item(h.text)
        if item_id is not None:
            anchors.append(
                _Anchor(
                    item_id=item_id,
                    char_offset=h.char_offset,
                    raw_title=h.text.strip(),
                    is_toc=h.is_table_of_contents,
                )
            )
    _flag_toc_by_density(anchors)
    return anchors


def _flag_toc_by_density(anchors: list[_Anchor]) -> None:
    """Density-based TOC detection.

    Find the *single densest* 3,000-char window. If it contains ≥ 10 item
    anchors, mark only those anchors as TOC. Catches filings whose
    normalizer-level Part-I detection missed (e.g. MSFT) without over-flagging
    multiple body regions as TOC.
    """
    if len(anchors) < 10:
        return
    sorted_by_off = sorted(anchors, key=lambda a: a.char_offset)
    n = len(sorted_by_off)
    best_start = best_end = -1
    best_count = 0
    for i in range(n):
        window_end = sorted_by_off[i].char_offset + 3000
        j = i
        while j + 1 < n and sorted_by_off[j + 1].char_offset <= window_end:
            j += 1
        count = j - i + 1
        if count > best_count:
            best_count = count
            best_start, best_end = i, j
    if best_count >= 10:
        for k in range(best_start, best_end + 1):
            sorted_by_off[k].is_toc = True


def _title_matches_canonical(item_id: str, raw_title: str) -> bool:
    """Loose match: does the raw_title start with words from the SEC title?

    Anchors emitted from page running-headers have empty or single-word titles;
    real section openers spell out at least the first 6 chars of the canonical.
    """
    if not raw_title:
        return False
    canonical = ITEM_CANONICAL_TITLE.get(item_id, "").upper()
    if not canonical:
        return False
    # Take the first 6 chars of canonical (after stripping punctuation) and
    # check the raw title starts with them.
    needle = re.sub(r"[^A-Z]", "", canonical)[:6]
    haystack = re.sub(r"[^A-Z]", "", raw_title.upper())
    return bool(needle) and haystack.startswith(needle)


def _pick_body_anchors(anchors: list[_Anchor]) -> list[_Anchor]:
    """Pick the canonical body anchor for each item id.

    Selection signal: **gap to the next anchor (any item) in document order**.

    Body section openers have lots of content following them (next anchor is
    KB-to-MB away). TOC entries and page running-headers are immediately
    followed by the next line of TOC / next page header (≤ 200–500 chars).

    This is more robust than the previous `is_toc` flag from
    `normalize.py`, which depends on detecting an explicit "PART I" heading
    that some filers (Intel, Citi, many large-cap iXBRL submissions) do not
    emit as a styled heading at all.

    Priority order (first match wins per item id):
      1. Title-matched anchor with overall-gap ≥ 2000 chars.
      2. Anchor with overall-gap ≥ 2000 chars (any title).
      3. Title-matched anchor (regardless of gap).
      4. Earliest anchor (first occurrence — for filings where no anchor has
         a substantial trailing gap, e.g. quarantine-tier extractions).
    """
    if not anchors:
        return []

    sorted_by_off = sorted(anchors, key=lambda a: a.char_offset)
    n = len(sorted_by_off)
    # max_offset acts as a soft document upper bound; we add a small padding
    # so the last anchor isn't trivially "far" just because there's nothing
    # after it. Using max_offset (rather than a 1M placeholder) prevents
    # TOC anchors at the back of the document from out-ranking real body
    # anchors that have ~tens-of-thousands of chars of trailing content.
    max_offset = sorted_by_off[-1].char_offset
    gap_to_next_overall: list[int] = []
    for i, a in enumerate(sorted_by_off):
        if i + 1 < n:
            gap_to_next_overall.append(sorted_by_off[i + 1].char_offset - a.char_offset)
        else:
            # Estimate trailing content as max-offset to here, capped small —
            # the last anchor genuinely has unknown trailing content.
            gap_to_next_overall.append(min(5000, max_offset - a.char_offset + 1000))

    by_id_title_far: dict[str, _Anchor] = {}
    by_id_far: dict[str, _Anchor] = {}
    by_id_title: dict[str, _Anchor] = {}
    by_id_first: dict[str, _Anchor] = {}

    SECTION_GAP_THRESHOLD = 2000

    for a, gap in zip(sorted_by_off, gap_to_next_overall, strict=True):
        if a.item_id not in by_id_first:
            by_id_first[a.item_id] = a  # earliest occurrence
        title_match = _title_matches_canonical(a.item_id, a.raw_title)
        is_far = gap >= SECTION_GAP_THRESHOLD
        # Strongest signal: title match + large trailing gap → body section opener
        if title_match and is_far and a.item_id not in by_id_title_far:
            by_id_title_far[a.item_id] = a
        # Second-strongest: large trailing gap alone
        if is_far and a.item_id not in by_id_far:
            by_id_far[a.item_id] = a
        # Third: title match regardless of gap
        if title_match and a.item_id not in by_id_title:
            by_id_title[a.item_id] = a

    chosen: dict[str, _Anchor] = {}
    for item_id in TEN_K_ITEM_IDS:
        if item_id in by_id_title_far:
            chosen[item_id] = by_id_title_far[item_id]
        elif item_id in by_id_far:
            chosen[item_id] = by_id_far[item_id]
        elif item_id in by_id_title:
            chosen[item_id] = by_id_title[item_id]
        elif item_id in by_id_first:
            chosen[item_id] = by_id_first[item_id]

    return sorted(chosen.values(), key=lambda a: a.char_offset)


def _slice_content(text: str, start: int, end: int) -> str:
    raw = text[start:end]
    # Strip leading line whitespace and the heading line itself; the heading is
    # already at `start`, so we walk past the first newline.
    first_nl = raw.find("\n")
    if first_nl > 0:
        raw = raw[first_nl + 1:]
    return raw.strip()


def extract_l1(ir: NormalizedFiling) -> list[ExtractedItem]:
    """Run L1 anchor extraction. Returns items in document order."""
    raw_anchors = _scan_anchors(ir)
    if not raw_anchors:
        logger.warning("l1_no_anchors_found")
        return []

    anchors = _pick_body_anchors(raw_anchors)
    if not anchors:
        return []

    items: list[ExtractedItem] = []
    for i, a in enumerate(anchors):
        end = anchors[i + 1].char_offset if i + 1 < len(anchors) else ir.char_total
        content = _slice_content(ir.text, a.char_offset, end)
        canonical_title = ITEM_CANONICAL_TITLE.get(a.item_id, a.raw_title or "")
        notes_parts: list[str] = []
        if a.is_toc:
            notes_parts.append("only TOC anchor found — body may be missing")
        if not content:
            notes_parts.append("empty content")
        items.append(
            ExtractedItem(
                item_id=a.item_id,
                title=canonical_title,
                content=content,
                start_offset=a.char_offset,
                end_offset=end,
                char_length=end - a.char_offset,
                confidence=0.0,  # filled by confidence.py
                extraction_method="L1",
                notes="; ".join(notes_parts) or None,
            )
        )
    return items
