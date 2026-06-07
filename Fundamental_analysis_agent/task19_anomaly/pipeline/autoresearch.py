"""LLM author for the price-anomaly agent."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from task19_anomaly.schemas import AnomalySpec

logger = get_logger(__name__)
_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task19_anomaly"
_ENTRY = {"buy_and_hold", "near_52w_high", "avoid_max_lottery", "tax_loss_reversal"}


@functools.lru_cache(maxsize=2)
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


def _spec(data: dict) -> AnomalySpec:
    e = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "buy_and_hold"
    s = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return AnomalySpec(entry_signal=e, high_threshold_pct=_cf(data.get("high_threshold_pct"), 1, 30, 5.0),
                       max_daily_threshold_pct=_cf(data.get("max_daily_threshold_pct"), 5, 50, 10.0),
                       max_window_days=_ci(data.get("max_window_days"), 5, 63, 21),
                       stop_loss_pct=_cf(data.get("stop_loss_pct"), 0, 90, 0.0), stance=s,
                       thesis=str(data.get("thesis", ""))[:1200], rationale=str(data.get("rationale", ""))[:600])


async def author_anomaly(*, trace_id: str, ticker: str, readings_block: str, budget_usd: float) -> AnomalySpec:
    sys_t, user_t = _load("anomaly_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task19.anomaly_author", tier=Tier.DEFAULT, system=sys_t,
                       messages=[{"role": "user", "content": user}], max_tokens=600, temperature=0.2,
                       response_format="json", cache_system=True), trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task19_author_failed", error=str(e)[:200])
        return AnomalySpec(entry_signal="buy_and_hold", thesis=f"author unavailable ({type(e).__name__})", rationale="baseline")
    data = resp.parsed_json
    if not isinstance(data, dict):
        return AnomalySpec(entry_signal="buy_and_hold", thesis="unparseable LLM output", rationale="baseline")
    spec = _spec(data)
    logger.info("task19_authored", entry=spec.entry_signal)
    return spec
