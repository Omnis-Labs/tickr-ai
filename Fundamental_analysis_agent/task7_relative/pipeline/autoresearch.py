"""Autoresearch — the LLM that turns relative-strength readings into a strategy.

Input:  an as-of snapshot of a ticker's relative strength vs its sector ETF.
Output: a validated `RelativeSpec` from the RS DSL, with a grounded thesis.
Readings are as-of (no later bars), so the context is lookahead-free; execution
is then deterministic.
"""

from __future__ import annotations

import functools
from datetime import date
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task7_relative.pipeline.indicators import readings_block
from task7_relative.schemas import RelativeSpec

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task7_relative"

_ENTRY = {"buy_and_hold", "rs_uptrend", "rs_breakout", "rs_momentum"}
_EXIT = {"hold", "rs_downtrend", "time_exit"}


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


def _spec_from_json(data: dict) -> RelativeSpec:
    entry = data.get("entry_signal")
    if entry not in _ENTRY:
        entry = "buy_and_hold"
    exit_ = data.get("exit_signal")
    if exit_ not in _EXIT:
        exit_ = "rs_downtrend"
    stance = data.get("stance")
    if stance not in ("bullish", "neutral", "cautious"):
        stance = "neutral"
    return RelativeSpec(
        entry_signal=entry,
        exit_signal=exit_,
        stance=stance,
        rs_sma=_clamp_int(data.get("rs_sma"), 5, 250, 50),
        rs_high_lookback=_clamp_int(data.get("rs_high_lookback"), 10, 252, 60),
        rs_momentum_lookback_days=_clamp_int(data.get("rs_momentum_lookback_days"), 10, 252, 90),
        rs_momentum_threshold_pct=_clamp_float(data.get("rs_momentum_threshold_pct"), -50, 100, 0.0),
        holding_days=_clamp_int(data.get("holding_days"), 5, 504, 120),
        stop_loss_pct=_clamp_float(data.get("stop_loss_pct"), 0, 90, 0.0),
        take_profit_pct=_clamp_float(data.get("take_profit_pct"), 0, 500, 0.0),
        thesis=str(data.get("thesis", ""))[:1200],
        rationale_entry=str(data.get("rationale_entry", ""))[:400],
        rationale_exit=str(data.get("rationale_exit", ""))[:400],
    )


def _fallback_spec(reason: str) -> RelativeSpec:
    return RelativeSpec(
        entry_signal="buy_and_hold", exit_signal="hold", stance="neutral",
        thesis=f"LLM relative-strength author unavailable ({reason}); defaulted to buy-and-hold.",
        rationale_entry="Baseline long exposure.", rationale_exit="Hold to end of window.",
    )


async def author_relative(
    *, trace_id: str, ticker: str, company: str, sector_label: str,
    readings: dict[str, float | str], as_of: date, budget_usd: float,
) -> RelativeSpec:
    sys_t, user_t = _load_prompt("relative_author")
    user = _render(
        user_t, ticker=ticker, company=company, sector_label=sector_label,
        as_of_date=as_of.isoformat(), readings_block=readings_block(readings),
    )
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id, purpose="task7.relative_author", tier=Tier.DEFAULT,
                system=sys_t, messages=[{"role": "user", "content": user}],
                max_tokens=800, temperature=0.2, response_format="json", cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task7_author_failed", error=str(e)[:200])
        return _fallback_spec(type(e).__name__)

    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback_spec("unparseable LLM output")
    spec = _spec_from_json(data)
    logger.info("task7_strategy_authored", entry=spec.entry_signal, exit=spec.exit_signal, stance=spec.stance)
    return spec
