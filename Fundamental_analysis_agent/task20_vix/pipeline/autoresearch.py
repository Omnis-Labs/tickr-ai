"""LLM author for the VIX-regime agent."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from task20_vix.schemas import VixSpec

logger = get_logger(__name__)
_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task20_vix"
_ENTRY = {"buy_and_hold", "vix_term_gate", "vix_level_gate"}


@functools.lru_cache(maxsize=2)
def _load(name: str) -> tuple[str, str]:
    t = (_DIR / f"{name}.md").read_text(encoding="utf-8")
    return t.split("## System", 1)[1].split("## User template", 1)[0].strip(), t.split("## User template", 1)[1].strip()


def _cf(v, lo, hi, d):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d


def _spec(data: dict) -> VixSpec:
    e = data.get("entry_signal") if data.get("entry_signal") in _ENTRY else "vix_term_gate"
    s = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    return VixSpec(entry_signal=e, term_threshold=_cf(data.get("term_threshold"), 0.85, 1.2, 1.0),
                   level_threshold=_cf(data.get("level_threshold"), 12, 60, 25.0),
                   stop_loss_pct=_cf(data.get("stop_loss_pct"), 0, 90, 0.0), stance=s,
                   thesis=str(data.get("thesis", ""))[:1200], rationale=str(data.get("rationale", ""))[:600])


async def author_vix(*, trace_id: str, ticker: str, readings_block: str, budget_usd: float) -> VixSpec:
    sys_t, user_t = _load("vix_author")
    user = user_t.replace("{{ticker}}", ticker).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task20.vix_author", tier=Tier.DEFAULT, system=sys_t,
                       messages=[{"role": "user", "content": user}], max_tokens=500, temperature=0.2,
                       response_format="json", cache_system=True), trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task20_author_failed", error=str(e)[:200])
        return VixSpec(entry_signal="vix_term_gate", thesis=f"author unavailable ({type(e).__name__})", rationale="baseline")
    data = resp.parsed_json
    if not isinstance(data, dict):
        return VixSpec(entry_signal="vix_term_gate", thesis="unparseable LLM output", rationale="baseline")
    spec = _spec(data)
    logger.info("task20_authored", entry=spec.entry_signal)
    return spec
