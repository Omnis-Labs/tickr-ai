"""Autoresearch — the LLM that turns seasonality readings into a calendar strategy."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task12_seasonality.schemas import SeasonalSpec

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task12_seasonality"
_ENTRY = {"buy_and_hold", "best_months", "sell_in_may", "turn_of_month"}


@functools.lru_cache(maxsize=4)
def _load_prompt(name: str) -> tuple[str, str]:
    text = (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    return (text.split("## System", 1)[1].split("## User template", 1)[0].strip(),
            text.split("## User template", 1)[1].strip())


def _ci(v, lo, hi, d):
    try:
        return max(lo, min(hi, int(float(v))))
    except (TypeError, ValueError):
        return d


def _spec_from_json(data: dict) -> SeasonalSpec:
    entry = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "buy_and_hold"
    stance = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    months = []
    if isinstance(data.get("months"), list):
        months = [m for m in (_ci(x, 1, 12, 0) for x in data["months"]) if m]
    if entry == "best_months" and not months:
        entry = "buy_and_hold"
    return SeasonalSpec(
        entry_signal=entry, months=sorted(set(months)),
        tom_before=_ci(data.get("tom_before"), 1, 10, 3),
        tom_after=_ci(data.get("tom_after"), 1, 10, 3),
        stance=stance, thesis=str(data.get("thesis", ""))[:1200],
        rationale=str(data.get("rationale", ""))[:600],
    )


def _fallback(reason: str) -> SeasonalSpec:
    return SeasonalSpec(entry_signal="buy_and_hold", stance="neutral",
                        thesis=f"LLM seasonality author unavailable ({reason}); defaulted to buy-and-hold.",
                        rationale="Baseline.")


async def author_seasonal(*, trace_id: str, ticker: str, readings_block: str, budget_usd: float) -> SeasonalSpec:
    sys_t, user_t = _load_prompt("seasonal_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task12.seasonal_author", tier=Tier.DEFAULT,
                       system=sys_t, messages=[{"role": "user", "content": user}],
                       max_tokens=600, temperature=0.2, response_format="json", cache_system=True),
            trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task12_author_failed", error=str(e)[:200])
        return _fallback(type(e).__name__)
    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback("unparseable LLM output")
    spec = _spec_from_json(data)
    logger.info("task12_strategy_authored", entry=spec.entry_signal, months=spec.months, stance=spec.stance)
    return spec
