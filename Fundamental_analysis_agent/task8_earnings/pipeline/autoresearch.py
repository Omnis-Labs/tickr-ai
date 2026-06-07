"""Autoresearch — the LLM that turns classified earnings events into a strategy.

Input:  an as-of summary of the company's recent earnings events (sentiment /
        guidance / beat-miss counts, the latest event).
Output: a validated `EarningsSpec` from the earnings DSL, with a grounded thesis.
Execution is then deterministic and lookahead-free.
"""

from __future__ import annotations

import functools
from datetime import date
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task8_earnings.schemas import EarningsSpec

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task8_earnings"

_ENTRY = {"any_earnings", "bullish", "bullish_or_raised", "beat"}
_EXIT = {"time_exit", "next_earnings"}


@functools.lru_cache(maxsize=4)
def _load_prompt(name: str) -> tuple[str, str]:
    text = (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    return (text.split("## System", 1)[1].split("## User template", 1)[0].strip(),
            text.split("## User template", 1)[1].strip())


def _clamp_int(v: object, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(float(v))))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _clamp_float(v: object, lo: float, hi: float, default: float) -> float:
    try:
        return max(lo, min(hi, float(v)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _spec_from_json(data: dict) -> EarningsSpec:
    entry = data.get("entry_signal")
    if entry not in _ENTRY:
        entry = "any_earnings"
    exit_ = data.get("exit_signal")
    if exit_ not in _EXIT:
        exit_ = "time_exit"
    stance = data.get("stance")
    if stance not in ("bullish", "neutral", "cautious"):
        stance = "neutral"
    return EarningsSpec(
        entry_signal=entry, exit_signal=exit_, stance=stance,
        holding_days=_clamp_int(data.get("holding_days"), 5, 120, 30),
        stop_loss_pct=_clamp_float(data.get("stop_loss_pct"), 0, 90, 0.0),
        take_profit_pct=_clamp_float(data.get("take_profit_pct"), 0, 500, 0.0),
        thesis=str(data.get("thesis", ""))[:1200],
        rationale_entry=str(data.get("rationale_entry", ""))[:400],
        rationale_exit=str(data.get("rationale_exit", ""))[:400],
    )


def _fallback_spec(reason: str) -> EarningsSpec:
    return EarningsSpec(
        entry_signal="any_earnings", exit_signal="time_exit", holding_days=30, stance="neutral",
        thesis=f"LLM earnings author unavailable ({reason}); defaulted to a 30-day post-earnings "
               f"drift after every release as a neutral baseline.",
        rationale_entry="Baseline PEAD exposure.", rationale_exit="Exit after the drift horizon.",
    )


async def author_earnings(
    *, trace_id: str, ticker: str, readings_block: str, as_of: date, budget_usd: float,
) -> EarningsSpec:
    sys_t, user_t = _load_prompt("earnings_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{as_of_date}}", as_of.isoformat()) \
                 .replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id, purpose="task8.earnings_author", tier=Tier.DEFAULT,
                system=sys_t, messages=[{"role": "user", "content": user}],
                max_tokens=700, temperature=0.2, response_format="json", cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task8_author_failed", error=str(e)[:200])
        return _fallback_spec(type(e).__name__)
    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback_spec("unparseable LLM output")
    spec = _spec_from_json(data)
    logger.info("task8_strategy_authored", entry=spec.entry_signal, exit=spec.exit_signal,
                hold=spec.holding_days, stance=spec.stance)
    return spec
