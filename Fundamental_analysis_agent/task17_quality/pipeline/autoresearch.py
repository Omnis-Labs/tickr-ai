"""LLM author for the fundamental-quality agent."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from task17_quality.schemas import QualitySpec

logger = get_logger(__name__)
_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task17_quality"
_ENTRY = {"buy_and_hold", "f_score", "low_accruals", "low_asset_growth", "composite_quality"}
_EXIT = {"deteriorating", "time_exit", "hold"}


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


def _spec(data: dict) -> QualitySpec:
    e = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "f_score"
    x = data.get("exit_signal") if data.get("exit_signal") in _EXIT else "deteriorating"
    s = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return QualitySpec(entry_signal=e, exit_signal=x,
                       f_threshold=_ci(data.get("f_threshold"), 1, 9, 7),
                       max_accruals_pct=_cf(data.get("max_accruals_pct"), -50, 50, 10.0),
                       max_asset_growth_pct=_cf(data.get("max_asset_growth_pct"), 0, 200, 25.0),
                       holding_days=_ci(data.get("holding_days"), 60, 504, 250),
                       stop_loss_pct=_cf(data.get("stop_loss_pct"), 0, 90, 0.0), stance=s,
                       thesis=str(data.get("thesis", ""))[:1200], rationale=str(data.get("rationale", ""))[:600])


async def author_quality(*, trace_id: str, ticker: str, readings_block: str, budget_usd: float) -> QualitySpec:
    sys_t, user_t = _load("quality_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task17.quality_author", tier=Tier.DEFAULT, system=sys_t,
                       messages=[{"role": "user", "content": user}], max_tokens=600, temperature=0.2,
                       response_format="json", cache_system=True), trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task17_author_failed", error=str(e)[:200])
        return QualitySpec(entry_signal="f_score", thesis=f"author unavailable ({type(e).__name__})", rationale="baseline")
    data = resp.parsed_json
    if not isinstance(data, dict):
        return QualitySpec(entry_signal="f_score", thesis="unparseable LLM output", rationale="baseline")
    spec = _spec(data)
    logger.info("task17_authored", entry=spec.entry_signal, f=spec.f_threshold)
    return spec
