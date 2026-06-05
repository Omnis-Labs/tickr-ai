"""HTML → normalized intermediate representation (IR).

Modern 10-Ks are huge iXBRL-embedded HTML files. We:
  1. Strip XBRL tags, scripts, styles, and SEC's giant inline data blobs.
  2. Flatten the visible text into a single string with stable char offsets.
  3. Build a parallel list of "candidate heading" records that L1 will scan.

The IR is JSON-serialisable and stored as an artifact so downstream layers
(L2, L3) can reload it without re-parsing the 5 MB raw HTML each time.
"""

from __future__ import annotations

import re
import warnings
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, NavigableString, Tag
from bs4 import XMLParsedAsHTMLWarning

# Modern 10-Ks are iXBRL — XML-with-HTML-shell. We deliberately parse with the
# HTML parser (lxml) because we want HTML semantics (heading detection, style
# inspection). The XBRL data is dropped before parsing anyway. Mute the noisy
# warning bs4 emits about this choice.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

from shared.artifacts import put_artifact
from shared.logging import get_logger

logger = get_logger(__name__)


@dataclass
class HeadingCandidate:
    """A piece of text that looks like it might be a section header."""

    text: str                # the visible text of the heading (collapsed whitespace)
    char_offset: int          # char index in normalized text
    tag: str                  # source tag name (e.g. "h1", "p", "span")
    font_weight: str | None   # "bold" / "normal" / None
    font_size_hint: int | None  # approximation from CSS font-size or tag rank
    is_table_of_contents: bool = False


@dataclass
class TocAnchor:
    """A TOC entry that links to an in-page anchor (e.g. <a href="#item7a">).

    L2 uses these to reverse-lookup body positions when L1's regex-based
    detection misses the heading (which happens when the body heading is
    visually styled rather than a proper `<h*>` tag).
    """

    link_text: str                # visible text inside the <a>, e.g. "Item 7A. MD&A"
    target_anchor: str            # the href without the leading "#"
    char_offset_in_text: int      # where the TOC link itself sits in normalized text


@dataclass
class AnchorTarget:
    """An <a name=...> or `id=...` anchor we encountered while walking the DOM.

    Mapping target_id → char offset in normalized text. Lets L2 jump from
    a TOC `href="#item7a"` to the body location.
    """

    target_id: str
    char_offset: int


@dataclass
class NormalizedFiling:
    text: str                                 # the canonical plain-text body
    headings: list[HeadingCandidate]          # all candidate headings
    toc_anchors: list[TocAnchor] = field(default_factory=list)
    anchor_targets: list[AnchorTarget] = field(default_factory=list)
    inferred_title: str | None = None         # from <title> or <h1>
    char_total: int = 0
    meta: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "headings": [h.__dict__ for h in self.headings],
            "toc_anchors": [t.__dict__ for t in self.toc_anchors],
            "anchor_targets": [a.__dict__ for a in self.anchor_targets],
            "inferred_title": self.inferred_title,
            "char_total": self.char_total,
            "meta": self.meta,
        }


# Tags whose content we keep but do not treat as headings.
_BLOCK_TAGS = {"p", "div", "li", "td", "th", "br", "section", "article"}
# Heading-bearing tags ranked by font_size_hint.
_HEADING_TAGS = {
    "h1": 6, "h2": 5, "h3": 4, "h4": 3, "h5": 2, "h6": 1,
}
# Tags to drop entirely (content not useful for item extraction).
_DROP_TAGS = {
    "script", "style", "noscript", "head", "meta", "link",
    # iXBRL tags carry data only — visible text is duplicated elsewhere.
    "ix:hidden", "xbrl",
}

_WHITESPACE_RE = re.compile(r"[ \t]+")
_NEWLINE_RUN_RE = re.compile(r"\n{3,}")


def _is_bold(tag: Tag) -> bool:
    style = (tag.get("style") or "").lower()
    if "font-weight" in style:
        m = re.search(r"font-weight\s*:\s*([\w\d]+)", style)
        if m:
            val = m.group(1)
            try:
                return int(val) >= 600
            except ValueError:
                return val in {"bold", "bolder"}
    return tag.name in {"b", "strong"}


def _font_size_hint(tag: Tag) -> int | None:
    """Best-effort numeric font size, larger = more likely a header."""
    if tag.name in _HEADING_TAGS:
        return _HEADING_TAGS[tag.name]
    style = (tag.get("style") or "").lower()
    m = re.search(r"font-size\s*:\s*(\d+(?:\.\d+)?)\s*(pt|px|em|rem)?", style)
    if m:
        try:
            return int(round(float(m.group(1))))
        except ValueError:
            return None
    return None


def _clean(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def normalize_html(html: str) -> NormalizedFiling:
    """Parse + normalize a 10-K HTML document.

    Performance note: lxml is the fast backend; for a 5 MB filing this takes
    ~1–2s on commodity hardware. Output is JSON-serialisable for caching.
    """
    soup = BeautifulSoup(html, "lxml")

    # Strip noise
    for selector in _DROP_TAGS:
        for el in soup.find_all(selector):
            el.decompose()

    text_parts: list[str] = []
    headings: list[HeadingCandidate] = []
    toc_anchors: list[TocAnchor] = []
    anchor_targets: list[AnchorTarget] = []
    cursor = 0  # running char offset

    title_tag = soup.find("title")
    inferred_title = _clean(title_tag.get_text()) if title_tag else None

    # Detect whether we're inside a TOC: filings often have a TOC near the top
    # with item links. We mark headings as is_table_of_contents=True if they
    # appear before the first body item header to avoid double-counting.
    seen_first_item_body = False

    def _emit(text: str) -> int:
        nonlocal cursor
        if not text:
            return cursor
        prev = cursor
        text_parts.append(text)
        cursor += len(text)
        return prev

    def _record_anchor_targets(tag: Tag) -> None:
        # `<a name="item1A">` (legacy SEC style) — record current cursor
        a_name = tag.get("name") if tag.name == "a" else None
        if a_name:
            anchor_targets.append(AnchorTarget(target_id=a_name, char_offset=cursor))
        # `id="item1A"` on any tag — modern iXBRL style
        el_id = tag.get("id")
        if el_id:
            anchor_targets.append(AnchorTarget(target_id=el_id, char_offset=cursor))

    def _walk(node) -> None:
        nonlocal seen_first_item_body
        if isinstance(node, NavigableString):
            s = _clean(str(node))
            if s:
                _emit(s + " ")
            return
        if not isinstance(node, Tag):
            return
        name = (node.name or "").lower()

        # Record anchor targets BEFORE descending into children — the cursor
        # at this point is the start of the tag's content in normalized text.
        _record_anchor_targets(node)

        # TOC link detection: <a href="#item7a">Item 7A. ...</a>
        if name == "a":
            href = node.get("href") or ""
            if href.startswith("#") and len(href) > 1:
                link_text = _clean(node.get_text(" ", strip=True))
                if link_text and re.match(r"^\s*item\s+\d", link_text, re.IGNORECASE):
                    toc_anchors.append(
                        TocAnchor(
                            link_text=link_text,
                            target_anchor=href[1:],
                            char_offset_in_text=cursor,
                        )
                    )

        # Heading-ish?
        font_size = _font_size_hint(node)
        bold = _is_bold(node)
        text_inline = _clean(node.get_text(" ", strip=True)) if name not in _BLOCK_TAGS else None
        is_heading_like = (
            name in _HEADING_TAGS
            or (bold and text_inline and len(text_inline) < 200)
            or (font_size and font_size >= 4 and text_inline and len(text_inline) < 200)
        )

        if is_heading_like and text_inline:
            # Insert a newline boundary before headings for easier downstream parsing
            _emit("\n")
            offset_here = cursor
            _emit(text_inline + "\n")
            headings.append(
                HeadingCandidate(
                    text=text_inline,
                    char_offset=offset_here,
                    tag=name,
                    font_weight="bold" if bold else "normal",
                    font_size_hint=font_size,
                    is_table_of_contents=not seen_first_item_body,
                )
            )
            # Detect Part I onset to flip TOC flag
            if re.search(r"^\s*part\s+i\b", text_inline, re.IGNORECASE) and "PART" in text_inline.upper():
                seen_first_item_body = True
            return

        # Block tags: add their inline text then a newline
        if name in _BLOCK_TAGS:
            for child in node.children:
                _walk(child)
            if text_parts and not text_parts[-1].endswith("\n"):
                _emit("\n")
            return

        # Default: recurse
        for child in node.children:
            _walk(child)

    body = soup.body or soup
    for child in body.children:
        _walk(child)

    text = "".join(text_parts)
    text = _NEWLINE_RUN_RE.sub("\n\n", text)

    # If TOC heuristic never tripped (small filings without explicit "Part I"),
    # consider only the first 30% of headings as TOC candidates.
    if not seen_first_item_body and headings:
        cutoff_idx = max(1, len(headings) // 3)
        for h in headings[cutoff_idx:]:
            h.is_table_of_contents = False

    return NormalizedFiling(
        text=text,
        headings=headings,
        toc_anchors=toc_anchors,
        anchor_targets=anchor_targets,
        inferred_title=inferred_title,
        char_total=len(text),
    )


async def persist_ir(*, job_id: str, ir: NormalizedFiling) -> None:
    import json
    payload = json.dumps(ir.to_dict()).encode("utf-8")
    await put_artifact(f"{job_id}/normalized.json", payload, "application/json")
