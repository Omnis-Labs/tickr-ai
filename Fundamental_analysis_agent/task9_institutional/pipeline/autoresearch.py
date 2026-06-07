"""Autoresearch — the LLM that turns 13F readings into a following strategy."""

from __future__ import annotations

import functools
from datetime import date
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task9_institutional.schemas import InstitutionalSpec

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task9_institutional"
_ENTRY = {"any_holding", "accumulating", "new_buying"}
_EXIT = {"hold", "distributing", "time_exit"}


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


def _cf(v, lo, hi, d):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d


def _spec_from_json(data: dict) -> InstitutionalSpec:
    entry = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "accumulating"
    exit_ = data.get("exit_signal") if data.get("exit_signal") in _EXIT else "distributing"
    stance = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return InstitutionalSpec(
        entry_signal=entry, exit_signal=exit_, stance=stance,
        accumulation_lookback_days=_ci(data.get("accumulation_lookback_days"), 90, 365, 180),
        holding_days=_ci(data.get("holding_days"), 30, 504, 120),
        stop_loss_pct=_cf(data.get("stop_loss_pct"), 0, 90, 0.0),
        take_profit_pct=_cf(data.get("take_profit_pct"), 0, 500, 0.0),
        thesis=str(data.get("thesis", ""))[:1200],
        rationale_entry=str(data.get("rationale_entry", ""))[:400],
        rationale_exit=str(data.get("rationale_exit", ""))[:400],
    )


def _fallback(reason: str) -> InstitutionalSpec:
    return InstitutionalSpec(
        entry_signal="accumulating", exit_signal="distributing", stance="neutral",
        thesis=f"LLM 13F author unavailable ({reason}); defaulted to following net accumulation "
               f"by the tracked funds over a 180-day window.",
        rationale_entry="Long while tracked funds accumulate.",
        rationale_exit="Exit when they distribute.",
    )


async def author_institutional(
    *, trace_id: str, ticker: str, readings_block: str, as_of: date, budget_usd: float,
) -> InstitutionalSpec:
    sys_t, user_t = _load_prompt("institutional_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{as_of_date}}", as_of.isoformat()) \
                 .replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id, purpose="task9.institutional_author", tier=Tier.DEFAULT,
                system=sys_t, messages=[{"role": "user", "content": user}],
                max_tokens=700, temperature=0.2, response_format="json", cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task9_author_failed", error=str(e)[:200])
        return _fallback(type(e).__name__)
    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback("unparseable LLM output")
    spec = _spec_from_json(data)
    logger.info("task9_strategy_authored", entry=spec.entry_signal, exit=spec.exit_signal, stance=spec.stance)
    return spec
