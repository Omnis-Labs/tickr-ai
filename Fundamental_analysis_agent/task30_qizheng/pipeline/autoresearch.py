"""LLM author for the 七政四餘 PLACEBO agent."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from task30_qizheng.schemas import QizhengSpec

logger = get_logger(__name__)
_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task30_qizheng"
_ENTRY = {"buy_and_hold","benefic_transit","avoid_malefic"}


@functools.lru_cache(maxsize=4)
def _load(name: str) -> tuple[str, str]:
    t = (_DIR / f"{name}.md").read_text(encoding="utf-8")
    return (t.split("## System", 1)[1].split("## User template", 1)[0].strip(),
            t.split("## User template", 1)[1].strip())


def _cf(v, lo, hi, d):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d


def _spec(data: dict) -> QizhengSpec:
    e = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "buy_and_hold"
    s = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return QizhengSpec(entry_signal=e, stop_loss_pct=_cf(data.get("stop_loss_pct"), 0, 90, 0.0),
                  stance=s, thesis=str(data.get("thesis", ""))[:1200], rationale=str(data.get("rationale", ""))[:600])


async def author_qizheng(*, trace_id: str, ticker: str, readings_block: str, budget_usd: float) -> QizhengSpec:
    sys_t, user_t = _load("qizheng_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task30.qizheng_author", tier=Tier.DEFAULT, system=sys_t,
                       messages=[{"role": "user", "content": user}], max_tokens=600, temperature=0.4,
                       response_format="json", cache_system=True), trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task30_qizheng_author_failed", error=str(e)[:200])
        return QizhengSpec(entry_signal="benefic_transit", thesis=f"author unavailable ({type(e).__name__})", rationale="placebo control")
    data = resp.parsed_json
    if not isinstance(data, dict):
        return QizhengSpec(entry_signal="benefic_transit", thesis="unparseable", rationale="placebo control")
    spec = _spec(data)
    logger.info("task30_qizheng_authored", entry=spec.entry_signal)
    return spec
