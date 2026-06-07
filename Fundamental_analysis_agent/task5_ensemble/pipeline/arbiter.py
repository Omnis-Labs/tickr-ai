"""Arbiter — the LLM that decides HOW to fuse the fundamental + technical agents.

Input:  each leg's stance, thesis, chosen entry/exit signals, and forward-looking
        context (Task 3's 10-K citations, Task 4's as-of indicator readings).
        It is deliberately NOT given either leg's realized backtest returns
        (ADR-008): the combine policy must be chosen from forward reasoning, not
        fit to the window it will then be tested on.
Output: a validated `EnsemblePolicy` — one combine_mode from the fixed DSL, leg
        weights, a resolved house stance, and a written conflict resolution.

If the LLM is unavailable, a deterministic stance-based fallback keeps the agent
running (fail soft, never silent — the fallback reason is logged + surfaced).
"""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task5_ensemble.schemas import EnsemblePolicy

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task5_ensemble"

_COMBINE_MODES = {
    "and", "or", "weighted",
    "fundamental_gated_technical", "defer_fundamental", "defer_technical",
}
_STANCES = {"bullish", "neutral", "cautious"}
_AGREEMENTS = {"agree", "conflict", "partial", "single_leg"}


@functools.lru_cache(maxsize=4)
def _load_prompt(name: str) -> tuple[str, str]:
    text = (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    sys_part = text.split("## System", 1)[1].split("## User template", 1)[0].strip()
    user_part = text.split("## User template", 1)[1].strip()
    return sys_part, user_part


def _render(template: str, **kw: object) -> str:
    out = template
    for k, v in kw.items():
        out = out.replace(f"{{{{{k}}}}}", str(v))
    return out


def _clamp_float(v: object, lo: float, hi: float, default: float) -> float:
    try:
        return max(lo, min(hi, float(v)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _policy_from_json(data: dict, *, fund_stance: str, tech_stance: str) -> EnsemblePolicy:
    """Validate + clamp the LLM JSON into an executable EnsemblePolicy."""
    mode = data.get("combine_mode")
    if mode not in _COMBINE_MODES:
        mode = "weighted"
    stance = data.get("resolved_stance")
    if stance not in _STANCES:
        stance = "neutral"
    agreement = data.get("agreement")
    if agreement not in _AGREEMENTS:
        agreement = "conflict" if fund_stance != tech_stance else "agree"
    return EnsemblePolicy(
        combine_mode=mode,
        fundamental_weight=_clamp_float(data.get("fundamental_weight"), 0.0, 1.0, 0.5),
        technical_weight=_clamp_float(data.get("technical_weight"), 0.0, 1.0, 0.5),
        resolved_stance=stance,
        agreement=agreement,
        arbitration_thesis=str(data.get("arbitration_thesis", ""))[:1200],
        conflict_resolution=str(data.get("conflict_resolution", ""))[:800],
    )


def deterministic_policy(*, fund_stance: str, tech_stance: str, reason: str) -> EnsemblePolicy:
    """Stance-only fallback when the LLM arbiter is unavailable.

    - agree (same stance):    weighted 50/50 — both agents back the same view.
    - conflict (differ):      fundamental_gated_technical — let conviction size timing.
    - either cautious:        the gate already pulls exposure toward flat.
    """
    if fund_stance == tech_stance:
        mode, agreement = "weighted", "agree"
        resolved = fund_stance
    else:
        mode, agreement = "fundamental_gated_technical", "conflict"
        # resolved view leans to the more cautious of the two
        order = {"cautious": 0, "neutral": 1, "bullish": 2}
        resolved = min(fund_stance, tech_stance, key=lambda s: order.get(s, 1))
    return EnsemblePolicy(
        combine_mode=mode,
        fundamental_weight=0.5,
        technical_weight=0.5,
        resolved_stance=resolved,  # type: ignore[arg-type]
        agreement=agreement,  # type: ignore[arg-type]
        arbitration_thesis=f"Deterministic fallback ({reason}): fundamental={fund_stance}, "
                           f"technical={tech_stance} → {mode}.",
        conflict_resolution="Arbiter LLM unavailable; combined by a fixed stance rule.",
    )


def single_leg_policy(*, available: str) -> EnsemblePolicy:
    """No arbitration needed — only one leg is available, defer to it."""
    mode = "defer_fundamental" if available == "fundamental" else "defer_technical"
    return EnsemblePolicy(
        combine_mode=mode,  # type: ignore[arg-type]
        resolved_stance="neutral",
        agreement="single_leg",
        arbitration_thesis=f"Only the {available} leg was available; the ensemble defers to it.",
        conflict_resolution=f"The other leg could not be produced for this ticker.",
    )


async def arbitrate(
    *,
    trace_id: str,
    ticker: str,
    fund_stance: str,
    fund_entry: str,
    fund_exit: str,
    fund_thesis: str,
    fund_citations: str,
    tech_stance: str,
    tech_entry: str,
    tech_exit: str,
    tech_thesis: str,
    tech_readings: str,
    budget_usd: float,
) -> EnsemblePolicy:
    sys_t, user_t = _load_prompt("ensemble_arbiter")
    user = _render(
        user_t,
        ticker=ticker,
        fund_stance=fund_stance, fund_entry=fund_entry, fund_exit=fund_exit,
        fund_thesis=fund_thesis, fund_citations=fund_citations,
        tech_stance=tech_stance, tech_entry=tech_entry, tech_exit=tech_exit,
        tech_thesis=tech_thesis, tech_readings=tech_readings,
    )
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id,
                purpose="task5.ensemble_arbiter",
                tier=Tier.DEFAULT,
                system=sys_t,
                messages=[{"role": "user", "content": user}],
                max_tokens=800,
                temperature=0.2,
                response_format="json",
                cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task5_arbiter_failed", error=str(e)[:200])
        return deterministic_policy(fund_stance=fund_stance, tech_stance=tech_stance,
                                    reason=type(e).__name__)

    data = resp.parsed_json
    if not isinstance(data, dict):
        return deterministic_policy(fund_stance=fund_stance, tech_stance=tech_stance,
                                    reason="unparseable LLM output")
    policy = _policy_from_json(data, fund_stance=fund_stance, tech_stance=tech_stance)
    logger.info("task5_arbitrated", mode=policy.combine_mode, stance=policy.resolved_stance,
                agreement=policy.agreement)
    return policy
