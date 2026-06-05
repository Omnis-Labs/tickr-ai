"""Autoresearch — the LLM that turns a 10-K into a testable strategy hypothesis.

Input:  a (non-quarantined) Task 2 `FilingExtraction` + price history.
Output: a validated `StrategySpec` — one strategy from the executable DSL, with
        a thesis and citations grounded in the 10-K.

The price statistics handed to the LLM are computed strictly as-of the filing
date (no later bars), so even the model's *context* is lookahead-free. The
strategy it picks is then executed deterministically by the backtest engine,
which is where the real out-of-sample test happens.
"""

from __future__ import annotations

import functools
import math
from datetime import date
from pathlib import Path

from shared.config import get_settings
from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from shared.schemas import FilingExtraction

from task3_strategy.schemas import PricePoint, StrategySpec, ThesisCitation

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task3_strategy"
_ITEM_TRUNC = 3_000


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


def price_summary_asof(prices: list[PricePoint], asof: date) -> str:
    """Human-readable price stats using ONLY bars on/before `asof`."""
    hist = [p for p in prices if p.date <= asof]
    if len(hist) < 20:
        return "Insufficient price history before the filing date."
    last = hist[-1].close
    window = hist[-252:]
    hi = max(p.high for p in window)
    lo = min(p.low for p in window)
    closes = [p.close for p in window]
    ret_1y = (closes[-1] / closes[0] - 1.0) * 100.0 if len(closes) > 1 else 0.0
    rets = [closes[i] / closes[i - 1] - 1.0 for i in range(1, len(closes))]
    vol = (math.sqrt(252) * (sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / max(1, len(rets) - 1)) ** 0.5 * 100.0) if len(rets) > 1 else 0.0
    pos = (last - lo) / (hi - lo) * 100.0 if hi > lo else 50.0
    return (
        f"- last close: ${last:.2f}\n"
        f"- trailing 52-week range: ${lo:.2f} – ${hi:.2f} (now {pos:.0f}% of range)\n"
        f"- trailing 1-year return: {ret_1y:+.1f}%\n"
        f"- annualised volatility: {vol:.0f}%"
    )


def _item_text(extraction: FilingExtraction, item_id: str) -> str:
    for it in extraction.items:
        if it.item_id == item_id:
            body = (it.content or "").strip()
            if it.incorporated_by_reference and not body:
                return "(incorporated by reference — not in body)"
            return body[:_ITEM_TRUNC] if body else "(empty)"
    return "(not extracted)"


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


def _spec_from_json(data: dict) -> StrategySpec:
    """Validate + clamp the LLM JSON into an executable StrategySpec."""
    entry = data.get("entry_signal")
    if entry not in ("buy_and_hold", "sma_cross", "momentum", "rsi_oversold"):
        entry = "buy_and_hold"
    exit_ = data.get("exit_signal")
    if exit_ not in ("hold", "sma_reverse", "rsi_overbought", "time_exit"):
        exit_ = "hold"
    stance = data.get("stance")
    if stance not in ("bullish", "neutral", "cautious"):
        stance = "neutral"

    fast = _clamp_int(data.get("sma_fast"), 2, 100, 20)
    slow = _clamp_int(data.get("sma_slow"), 5, 300, 50)
    if slow <= fast:
        slow = fast + 30

    cites = []
    for c in (data.get("citations") or [])[:6]:
        if isinstance(c, dict) and c.get("item_id"):
            cites.append(ThesisCitation(
                item_id=str(c.get("item_id"))[:4],
                item_title=str(c.get("item_title", ""))[:80],
                quote=str(c.get("quote", ""))[:400],
            ))

    return StrategySpec(
        entry_signal=entry,
        exit_signal=exit_,
        stance=stance,
        sma_fast=fast,
        sma_slow=slow,
        momentum_lookback_days=_clamp_int(data.get("momentum_lookback_days"), 5, 252, 60),
        momentum_threshold_pct=_clamp_float(data.get("momentum_threshold_pct"), -50, 100, 5.0),
        rsi_period=_clamp_int(data.get("rsi_period"), 2, 50, 14),
        rsi_oversold=_clamp_float(data.get("rsi_oversold"), 5, 50, 30.0),
        rsi_overbought=_clamp_float(data.get("rsi_overbought"), 50, 95, 70.0),
        time_exit_days=_clamp_int(data.get("time_exit_days"), 5, 756, 120),
        stop_loss_pct=_clamp_float(data.get("stop_loss_pct"), 0, 90, 0.0),
        take_profit_pct=_clamp_float(data.get("take_profit_pct"), 0, 500, 0.0),
        thesis=str(data.get("thesis", ""))[:1200],
        rationale_entry=str(data.get("rationale_entry", ""))[:400],
        rationale_exit=str(data.get("rationale_exit", ""))[:400],
        citations=cites,
    )


def _fallback_spec(reason: str) -> StrategySpec:
    return StrategySpec(
        entry_signal="buy_and_hold", exit_signal="hold", stance="neutral",
        thesis=f"LLM strategy author unavailable ({reason}); defaulted to buy-and-hold "
               f"from the filing date as a neutral baseline.",
        rationale_entry="Baseline long exposure.", rationale_exit="Hold to end of window.",
    )


async def author_strategy(
    *, trace_id: str, ticker: str, extraction: FilingExtraction,
    prices: list[PricePoint], filing_date: date, budget_usd: float,
) -> StrategySpec:
    sys_t, user_t = _load_prompt("strategy_author")
    user = _render(
        user_t,
        ticker=ticker,
        company=extraction.filing.company_name or ticker,
        fiscal_year=extraction.filing.fiscal_year or "unknown",
        filing_date=filing_date.isoformat(),
        price_summary=price_summary_asof(prices, filing_date),
        item_1=_item_text(extraction, "1"),
        item_1a=_item_text(extraction, "1A"),
        item_7=_item_text(extraction, "7"),
    )
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id,
                purpose="task3.strategy_author",
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
        logger.warning("task3_author_failed", error=str(e)[:200])
        return _fallback_spec(type(e).__name__)

    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback_spec("unparseable LLM output")
    spec = _spec_from_json(data)
    logger.info("task3_strategy_authored", entry=spec.entry_signal, exit=spec.exit_signal, stance=spec.stance)
    return spec
