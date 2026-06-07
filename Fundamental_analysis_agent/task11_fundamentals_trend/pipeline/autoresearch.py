"""Autoresearch — the LLM that turns fundamentals-trend readings into a strategy."""

from __future__ import annotations

import functools
from datetime import date
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task11_fundamentals_trend.schemas import FundTrendSpec

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task11_fundamentals_trend"
_ENTRY = {"revenue_growth", "earnings_growth", "margin_expansion", "growth_and_margin", "any_improving"}
_EXIT = {"deteriorating", "time_exit", "hold"}


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


def _spec_from_json(data: dict) -> FundTrendSpec:
    entry = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "any_improving"
    exit_ = data.get("exit_signal") if data.get("exit_signal") in _EXIT else "deteriorating"
    stance = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return FundTrendSpec(
        entry_signal=entry, exit_signal=exit_, stance=stance,
        revenue_growth_threshold_pct=_cf(data.get("revenue_growth_threshold_pct"), -50, 200, 0.0),
        earnings_growth_threshold_pct=_cf(data.get("earnings_growth_threshold_pct"), -100, 500, 0.0),
        holding_days=_ci(data.get("holding_days"), 30, 504, 120),
        stop_loss_pct=_cf(data.get("stop_loss_pct"), 0, 90, 0.0),
        take_profit_pct=_cf(data.get("take_profit_pct"), 0, 500, 0.0),
        thesis=str(data.get("thesis", ""))[:1200],
        rationale_entry=str(data.get("rationale_entry", ""))[:400],
        rationale_exit=str(data.get("rationale_exit", ""))[:400],
    )


def _fallback(reason: str) -> FundTrendSpec:
    return FundTrendSpec(
        entry_signal="any_improving", exit_signal="deteriorating", stance="neutral",
        thesis=f"LLM fundamentals author unavailable ({reason}); defaulted to following improving "
               f"YoY revenue/earnings.",
        rationale_entry="Long while fundamentals improve YoY.",
        rationale_exit="Exit when growth turns negative.",
    )


async def author_fundtrend(
    *, trace_id: str, ticker: str, readings_block: str, as_of: date, budget_usd: float,
) -> FundTrendSpec:
    sys_t, user_t = _load_prompt("fundtrend_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{as_of_date}}", as_of.isoformat()) \
                 .replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id, purpose="task11.fundtrend_author", tier=Tier.DEFAULT,
                system=sys_t, messages=[{"role": "user", "content": user}],
                max_tokens=700, temperature=0.2, response_format="json", cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task11_author_failed", error=str(e)[:200])
        return _fallback(type(e).__name__)
    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback("unparseable LLM output")
    spec = _spec_from_json(data)
    logger.info("task11_strategy_authored", entry=spec.entry_signal, exit=spec.exit_signal, stance=spec.stance)
    return spec
