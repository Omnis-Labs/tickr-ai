"""L3 — LLM self-consistency extractor.

Runs ONLY when L1 + L2 leave specific required items at low confidence. For
each suspect item, we send two independent prompts (per-item probe + whole-
chunk scan), compare their boundary proposals, and emit an L3 candidate
when they agree.

Design choices (matches PLAN.md §3.4):

  * **Chunked input** — a full 10-K is 200K–500K chars, well beyond a
    single-call context. We slice the document into overlapping ~12K-char
    windows centred on L1's best-guess position for each suspect item.
  * **Budget cap per filing** — `task2_budget_usd` from settings; default
    $0.10. If processing one item would exceed cap, we skip the rest.
  * **Self-consistency** — body_start_offset from Prompt A and matching
    `items[].body_start_offset` from Prompt B must agree within 500 chars
    (IoU proxy for boundaries we don't yet have an end for). Disagreement
    → mark suspect, don't replace L1/L2.
  * **No silent overrides** — L3 only *adds* or *refines* items; never
    deletes an L1/L2 item without producing a replacement.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from shared.config import get_settings
from shared.cost_ledger import cost_for_trace
from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from shared.schemas import TEN_K_ITEM_IDS, ExtractedItem

from task2_10k_extractor.pipeline.l1_anchor import ITEM_CANONICAL_TITLE
from task2_10k_extractor.pipeline.normalize import NormalizedFiling

logger = get_logger(__name__)

# Prompt template loader — tiny mustache replacement, no escaping.
import functools
from pathlib import Path

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task2_10k"


@functools.lru_cache(maxsize=8)
def _load_prompt(name: str) -> tuple[str, str]:
    text = (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    sys_marker = "## System"
    user_marker = "## User template"
    sys_part = text.split(sys_marker, 1)[1].split(user_marker, 1)[0].strip()
    user_part = text.split(user_marker, 1)[1].strip()
    return sys_part, user_part


def _render(template: str, **kwargs: object) -> str:
    out = template
    for k, v in kwargs.items():
        out = out.replace(f"{{{{{k}}}}}", str(v))
    return out


@dataclass
class _Candidate:
    item_id: str
    body_start_global: int
    body_end_global: int | None
    source: str   # "A" or "B"
    raw_confidence: float


def _build_chunk(ir: NormalizedFiling, around_offset: int, half_width: int = 6000) -> tuple[str, int, int]:
    """Return (chunk_text, global_start, global_end) centred on a given offset."""
    n = ir.char_total
    start = max(0, around_offset - half_width)
    end = min(n, around_offset + half_width)
    return ir.text[start:end], start, end


async def extract_l3_for_item(
    *,
    trace_id: str,
    item_id: str,
    ir: NormalizedFiling,
    seed_offset: int,
    budget_usd: float,
) -> ExtractedItem | None:
    """Probe one suspect item with two independent prompts. Returns an L3
    ExtractedItem if both prompts agree on the boundary, else None.

    `seed_offset` should be L1/L2's best guess for where the item likely
    starts (or the document midpoint if no prior signal).
    """
    settings = get_settings()
    chunk, global_start, global_end = _build_chunk(ir, seed_offset)

    sys_a, user_a_tmpl = _load_prompt("extractor_a")
    sys_b, user_b_tmpl = _load_prompt("extractor_b")
    item_title = ITEM_CANONICAL_TITLE.get(item_id, "")

    # ---- Prompt A: per-item ------------------------------------------------
    user_a = _render(
        user_a_tmpl,
        item_id=item_id,
        item_title=item_title,
        chunk_global_start=global_start,
        chunk_global_end=global_end,
        chunk_text=chunk,
    )
    resp_a = await LLMGateway.instance().call(
        LLMRequest(
            trace_id=trace_id,
            purpose="task2.l3.extractor_a",
            tier=Tier.DEFAULT,
            system=sys_a,
            messages=[{"role": "user", "content": user_a}],
            max_tokens=400,
            temperature=0.0,
            response_format="json",
            cache_system=True,
        ),
        trace_budget_usd=budget_usd,
    )
    a_data = resp_a.parsed_json or {}
    if not a_data.get("found"):
        return None

    # ---- Prompt B: whole-chunk scan ---------------------------------------
    user_b = _render(
        user_b_tmpl,
        chunk_global_start=global_start,
        chunk_global_end=global_end,
        chunk_text=chunk,
    )
    resp_b = await LLMGateway.instance().call(
        LLMRequest(
            trace_id=trace_id,
            purpose="task2.l3.extractor_b",
            tier=Tier.DEFAULT,
            system=sys_b,
            messages=[{"role": "user", "content": user_b}],
            # 900 was truncating prompt B's multi-item array mid-object
            # ("Unterminated string"). The fix is the salvage path in
            # llm_gateway._coerce_json (recovers items before the cutoff) — not
            # simply raising the cap, which only trades latency for ~0 extra
            # recovery (prompt B still disagrees on the hard items). See ADR-007.
            max_tokens=1024,
            temperature=0.0,
            response_format="json",
            cache_system=True,
        ),
        trace_budget_usd=budget_usd,
    )
    b_data = resp_b.parsed_json or {}
    b_items = b_data.get("items", []) or []
    b_match = next((b for b in b_items if str(b.get("item_id")) == item_id), None)

    # ---- Self-consistency check -------------------------------------------
    a_start_local = int(a_data.get("body_start_offset", -1))
    if a_start_local < 0:
        return None
    if b_match is None:
        logger.info(
            "l3_disagreement",
            item_id=item_id,
            reason="prompt B did not find this item",
        )
        return None
    b_start_local = int(b_match.get("body_start_offset", -1))
    # Boundary IoU proxy: |A_start - B_start| within tolerance
    if abs(a_start_local - b_start_local) > 500:
        logger.info(
            "l3_disagreement",
            item_id=item_id,
            a=a_start_local,
            b=b_start_local,
            delta=abs(a_start_local - b_start_local),
        )
        return None

    # Both agree. Convert to global offsets and slice content.
    body_start_global = global_start + min(a_start_local, b_start_local)
    body_end_local = int(a_data.get("body_end_offset", -1))
    if body_end_local > 0 and body_end_local > a_start_local:
        body_end_global = global_start + body_end_local
    else:
        body_end_global = global_end  # best-effort

    content = ir.text[body_start_global:body_end_global].strip()
    if not content:
        return None

    return ExtractedItem(
        item_id=item_id,
        title=item_title or item_id,
        content=content,
        start_offset=body_start_global,
        end_offset=body_end_global,
        char_length=body_end_global - body_start_global,
        confidence=0.0,
        extraction_method="L3",
        notes=(
            f"L3 self-consistency: A@+{a_start_local} vs B@+{b_start_local} "
            f"(Δ={abs(a_start_local - b_start_local)})"
        ),
    )


def _missing_or_low_conf(
    items: list[ExtractedItem], required_ids: list[str], threshold: float
) -> list[str]:
    by_id = {it.item_id: it for it in items}
    out: list[str] = []
    for iid in required_ids:
        it = by_id.get(iid)
        if it is None or it.confidence < threshold:
            out.append(iid)
    return out


async def maybe_extract_l3(
    *,
    trace_id: str,
    items: list[ExtractedItem],
    ir: NormalizedFiling,
) -> list[ExtractedItem]:
    """Top-level L3 entry point. Returns possibly-augmented item list.

    Budget-aware: stops invoking L3 once `task2_budget_usd` cap reached.
    """
    settings = get_settings()
    budget = settings.task2_budget_usd

    from task2_10k_extractor.pipeline.confidence import REQUIRED_ITEMS

    suspects = _missing_or_low_conf(items, REQUIRED_ITEMS, threshold=0.6)
    if not suspects:
        return items

    by_id: dict[str, ExtractedItem] = {it.item_id: it for it in items}
    augmented = list(items)

    for iid in suspects:
        spent = await cost_for_trace(trace_id)
        if spent >= budget:
            logger.warning(
                "l3_budget_exhausted",
                trace_id=trace_id,
                spent_usd=round(spent, 5),
                budget_usd=budget,
                remaining_suspects=len(suspects),
            )
            break
        # Use existing item's offset as seed if we have one; else use the
        # midpoint of the document as a starting probe.
        existing = by_id.get(iid)
        seed = existing.start_offset if existing else ir.char_total // 2
        try:
            l3_item = await extract_l3_for_item(
                trace_id=trace_id,
                item_id=iid,
                ir=ir,
                seed_offset=seed,
                budget_usd=budget,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("l3_call_failed", item_id=iid, error=str(e)[:200])
            continue
        if l3_item is None:
            continue
        # Replace the existing entry (or add if missing)
        for i, it in enumerate(augmented):
            if it.item_id == iid:
                augmented[i] = l3_item
                break
        else:
            augmented.append(l3_item)

    augmented.sort(key=lambda x: x.start_offset)
    if any(it.extraction_method == "L3" for it in augmented):
        n = sum(1 for it in augmented if it.extraction_method == "L3")
        logger.info("l3_engaged", trace_id=trace_id, recovered=n)
    return augmented
