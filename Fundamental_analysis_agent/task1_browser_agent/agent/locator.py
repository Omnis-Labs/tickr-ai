"""Locator — resolve an NL target description into a three-pronged Locator
using a fresh DOM snapshot from the live page.

Strategy ordering at probe time (handled by executor):
    primary CSS  →  semantic role+name  →  visual text

LLM is only invoked here when (a) we have no cached selector for this
(site, action) combination, or (b) all cached locators failed.
"""

from __future__ import annotations

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.schemas import Locator

from task1_browser_agent.agent.prompt_loader import render, split


async def resolve_locator(
    *,
    trace_id: str,
    target_description: str,
    dom_excerpt: str,
    a11y_tree: str,
    budget_usd: float,
    prefer_semantic: bool = False,
    prefer_visual: bool = False,
    avoid_selectors: list[str] | None = None,
    known_good: list[dict] | None = None,
) -> Locator:
    system, user_template = split("locator")
    user = render(
        user_template,
        target_description=target_description,
        dom_excerpt=dom_excerpt[:6000],
        a11y_tree=a11y_tree[:3000],
    )
    hints: list[str] = []
    # selector_history hint: if we've seen this (site, target) pair succeed
    # before, surface the working selector(s) so the LLM can adopt them
    # rather than reinventing. Net-positive selectors only.
    if known_good:
        positives = [g for g in known_good if g["success_count"] > g["failure_count"]]
        if positives:
            lines = []
            for g in positives[:3]:
                lines.append(
                    f"  primary={g['primary']!r} "
                    f"(seen working {g['success_count']}× / failing {g['failure_count']}×)"
                )
            hints.append(
                "KNOWN-GOOD selectors from prior successful runs for this "
                "(site, target) — prefer one of these if it still matches:\n"
                + "\n".join(lines)
            )
    if prefer_visual:
        hints.append(
            "Two prior attempts already failed on CSS and ARIA prongs. "
            "Set `primary` and `semantic_role` to null and rely on `visual_text` "
            "with the exact visible text of the target element."
        )
    elif prefer_semantic:
        hints.append("Primary CSS failed last time. Prefer semantic over primary.")
    if avoid_selectors:
        joined = ", ".join(repr(s) for s in avoid_selectors[-3:])
        hints.append(
            f"Do NOT propose the same primary selector(s) again: {joined}. "
            "If you have no different selector to offer, set `primary` to null."
        )
    if hints:
        user += "\n\nADDITIONAL CONSTRAINTS:\n- " + "\n- ".join(hints)

    resp = await LLMGateway.instance().call(
        LLMRequest(
            trace_id=trace_id,
            purpose="task1.locator",
            tier=Tier.DEFAULT,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=400,
            temperature=0.0,
            response_format="json",
            cache_system=True,
        ),
        trace_budget_usd=budget_usd,
    )
    data = resp.parsed_json or {}
    if not data.get("found", True):
        return Locator(notes=data.get("reason"))
    primary = data.get("primary")
    semantic_role = data.get("semantic_role")
    semantic_name = data.get("semantic_name")
    visual_text = data.get("visual_text")
    notes = data.get("notes")
    # When we've already escalated to visual mode (two prior attempts on
    # primary + semantic both failed) AND we have substantive visible text
    # to anchor on, enforce visual-only probing by erasing the upper prongs.
    # If the visual_text is empty or generic (e.g. "first paragraph"), the
    # visual prong won't match — keep the other prongs so the executor's
    # structural fallback (for EXTRACT) can still run.
    if prefer_visual and visual_text and len(visual_text) >= 8:
        primary = None
        semantic_role = None
        semantic_name = None
        notes = (notes or "") + " [forced visual-only by state machine]"
    return Locator(
        primary=primary,
        semantic_role=semantic_role,
        semantic_name=semantic_name,
        visual_text=visual_text,
        notes=notes,
    )
