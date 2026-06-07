"""Autoresearch — the LLM that picks a gap participation rule from the overnight/intraday split."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task13_overnight.schemas import GapSpec

logger = get_logger(__name__)
_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task13_overnight"
_ENTRY = {"buy_and_hold", "overnight", "intraday", "overnight_after_up"}


@functools.lru_cache(maxsize=4)
def _load_prompt(name: str) -> tuple[str, str]:
    text = (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    return (text.split("## System", 1)[1].split("## User template", 1)[0].strip(),
            text.split("## User template", 1)[1].strip())


def _spec(data: dict) -> GapSpec:
    entry = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "buy_and_hold"
    stance = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return GapSpec(entry_signal=entry, stance=stance,
                   thesis=str(data.get("thesis", ""))[:1200], rationale=str(data.get("rationale", ""))[:600])


def _fallback(reason: str) -> GapSpec:
    return GapSpec(entry_signal="buy_and_hold", stance="neutral",
                   thesis=f"LLM gap author unavailable ({reason}); defaulted to buy-and-hold.", rationale="Baseline.")


async def author_gap(*, trace_id: str, ticker: str, readings_block: str, budget_usd: float) -> GapSpec:
    sys_t, user_t = _load_prompt("gap_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task13.gap_author", tier=Tier.DEFAULT,
                       system=sys_t, messages=[{"role": "user", "content": user}],
                       max_tokens=500, temperature=0.2, response_format="json", cache_system=True),
            trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task13_author_failed", error=str(e)[:200])
        return _fallback(type(e).__name__)
    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback("unparseable LLM output")
    spec = _spec(data)
    logger.info("task13_strategy_authored", entry=spec.entry_signal, stance=spec.stance)
    return spec
