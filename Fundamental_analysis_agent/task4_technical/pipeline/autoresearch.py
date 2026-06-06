"""Autoresearch — the LLM that turns technical readings into a testable strategy.

Input:  a ticker's price history + a compact, as-of indicator-readings snapshot.
Output: a validated `TechnicalSpec` — one strategy from the executable technical
        DSL, with a thesis and rationale grounded in the readings.

The readings are computed strictly as-of the decision date (no later bars), so
even the model's *context* is lookahead-free. The strategy it picks is then
executed deterministically by the backtest engine, which is where the real
out-of-sample test happens.
"""

from __future__ import annotations

import functools
from datetime import date
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task4_technical.pipeline.indicators import readings_block
from task4_technical.schemas import PricePoint, TechnicalSpec

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task4_technical"

_ENTRY_SIGNALS = {
    "buy_and_hold", "sma_cross", "macd_cross", "rsi_oversold",
    "bollinger_breakout", "donchian_breakout", "momentum",
}
_EXIT_SIGNALS = {
    "hold", "sma_reverse", "macd_reverse", "rsi_overbought",
    "bollinger_revert", "donchian_stop", "time_exit",
}


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


def _spec_from_json(data: dict) -> TechnicalSpec:
    """Validate + clamp the LLM JSON into an executable TechnicalSpec."""
    entry = data.get("entry_signal")
    if entry not in _ENTRY_SIGNALS:
        entry = "buy_and_hold"
    exit_ = data.get("exit_signal")
    if exit_ not in _EXIT_SIGNALS:
        exit_ = "hold"
    stance = data.get("stance")
    if stance not in ("bullish", "neutral", "cautious"):
        stance = "neutral"

    fast = _clamp_int(data.get("sma_fast"), 2, 100, 20)
    slow = _clamp_int(data.get("sma_slow"), 5, 300, 50)
    if slow <= fast:
        slow = fast + 30

    macd_fast = _clamp_int(data.get("macd_fast"), 3, 50, 12)
    macd_slow = _clamp_int(data.get("macd_slow"), 5, 100, 26)
    if macd_slow <= macd_fast:
        macd_slow = macd_fast + 14

    vol_fast = _clamp_int(data.get("volume_fast"), 2, 60, 20)
    vol_slow = _clamp_int(data.get("volume_slow"), 10, 200, 50)
    if vol_slow <= vol_fast:
        vol_slow = vol_fast + 30

    return TechnicalSpec(
        entry_signal=entry,
        exit_signal=exit_,
        stance=stance,
        sma_fast=fast,
        sma_slow=slow,
        macd_fast=macd_fast,
        macd_slow=macd_slow,
        macd_signal=_clamp_int(data.get("macd_signal"), 2, 50, 9),
        rsi_period=_clamp_int(data.get("rsi_period"), 2, 50, 14),
        rsi_oversold=_clamp_float(data.get("rsi_oversold"), 5, 50, 30.0),
        rsi_overbought=_clamp_float(data.get("rsi_overbought"), 50, 95, 70.0),
        bollinger_period=_clamp_int(data.get("bollinger_period"), 5, 100, 20),
        bollinger_k=_clamp_float(data.get("bollinger_k"), 1.0, 4.0, 2.0),
        donchian_period=_clamp_int(data.get("donchian_period"), 5, 200, 20),
        momentum_lookback_days=_clamp_int(data.get("momentum_lookback_days"), 5, 252, 60),
        momentum_threshold_pct=_clamp_float(data.get("momentum_threshold_pct"), -50, 100, 5.0),
        time_exit_days=_clamp_int(data.get("time_exit_days"), 5, 756, 120),
        require_volume_confirm=bool(data.get("require_volume_confirm", False)),
        volume_fast=vol_fast,
        volume_slow=vol_slow,
        volume_confirm_ratio=_clamp_float(data.get("volume_confirm_ratio"), 0.5, 5.0, 1.0),
        stop_loss_pct=_clamp_float(data.get("stop_loss_pct"), 0, 90, 0.0),
        take_profit_pct=_clamp_float(data.get("take_profit_pct"), 0, 500, 0.0),
        thesis=str(data.get("thesis", ""))[:1200],
        rationale_entry=str(data.get("rationale_entry", ""))[:400],
        rationale_exit=str(data.get("rationale_exit", ""))[:400],
    )


def _fallback_spec(reason: str) -> TechnicalSpec:
    return TechnicalSpec(
        entry_signal="buy_and_hold", exit_signal="hold", stance="neutral",
        thesis=f"LLM technical author unavailable ({reason}); defaulted to buy-and-hold "
               f"over the backtest window as a neutral baseline.",
        rationale_entry="Baseline long exposure.", rationale_exit="Hold to end of window.",
    )


async def author_technical(
    *, trace_id: str, ticker: str, company: str,
    prices: list[PricePoint], as_of: date, readings: dict[str, float | str],
    budget_usd: float,
) -> TechnicalSpec:
    sys_t, user_t = _load_prompt("technical_author")
    user = _render(
        user_t,
        ticker=ticker,
        company=company,
        as_of_date=as_of.isoformat(),
        readings_block=readings_block(readings),
    )
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id,
                purpose="task4.technical_author",
                tier=Tier.DEFAULT,
                system=sys_t,
                messages=[{"role": "user", "content": user}],
                max_tokens=900,
                temperature=0.2,
                response_format="json",
                cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task4_author_failed", error=str(e)[:200])
        return _fallback_spec(type(e).__name__)

    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback_spec("unparseable LLM output")
    spec = _spec_from_json(data)
    logger.info("task4_strategy_authored", entry=spec.entry_signal, exit=spec.exit_signal, stance=spec.stance)
    return spec
