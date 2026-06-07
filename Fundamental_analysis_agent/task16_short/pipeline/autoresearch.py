"""LLM author for the short-pressure agent."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from task16_short.schemas import ShortSpec

logger = get_logger(__name__)
_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task16_short"
_ENTRY = {"buy_and_hold", "squeeze", "low_short", "si_squeeze", "low_si"}
_EXIT = {"short_normalizes", "time_exit", "hold"}


@functools.lru_cache(maxsize=4)
def _load(name: str) -> tuple[str, str]:
    t = (_DIR / f"{name}.md").read_text(encoding="utf-8")
    return t.split("## System", 1)[1].split("## User template", 1)[0].strip(), t.split("## User template", 1)[1].strip()


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


def _spec(data: dict) -> ShortSpec:
    e = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "buy_and_hold"
    x = data.get("exit_signal") if data.get("exit_signal") in _EXIT else "time_exit"
    s = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return ShortSpec(entry_signal=e, exit_signal=x,
                     svr_threshold_pct=_cf(data.get("svr_threshold_pct"), 10, 90, 50.0),
                     dtc_threshold=_cf(data.get("dtc_threshold"), 0.5, 30, 3.0),
                     sma_window=_ci(data.get("sma_window"), 20, 200, 50),
                     holding_days=_ci(data.get("holding_days"), 5, 252, 40),
                     stop_loss_pct=_cf(data.get("stop_loss_pct"), 0, 90, 0.0), stance=s,
                     thesis=str(data.get("thesis", ""))[:1200], rationale=str(data.get("rationale", ""))[:600])


async def author_short(*, trace_id: str, ticker: str, readings_block: str, budget_usd: float) -> ShortSpec:
    sys_t, user_t = _load("short_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task16.short_author", tier=Tier.DEFAULT, system=sys_t,
                       messages=[{"role": "user", "content": user}], max_tokens=600, temperature=0.2,
                       response_format="json", cache_system=True), trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task16_author_failed", error=str(e)[:200])
        return ShortSpec(entry_signal="buy_and_hold", thesis=f"author unavailable ({type(e).__name__})", rationale="baseline")
    data = resp.parsed_json
    if not isinstance(data, dict):
        return ShortSpec(entry_signal="buy_and_hold", thesis="unparseable LLM output", rationale="baseline")
    spec = _spec(data)
    logger.info("task16_authored", entry=spec.entry_signal, thr=spec.svr_threshold_pct)
    return spec
