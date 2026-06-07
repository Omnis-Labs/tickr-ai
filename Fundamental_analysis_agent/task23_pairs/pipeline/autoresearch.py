"""LLM author for the pairs-trading agent."""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from task23_pairs.schemas import PairSpec

logger = get_logger(__name__)
_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task23_pairs"


@functools.lru_cache(maxsize=4)
def _load(name: str) -> tuple[str, str]:
    t = (_DIR / f"{name}.md").read_text(encoding="utf-8")
    return (t.split("## System", 1)[1].split("## User template", 1)[0].strip(),
            t.split("## User template", 1)[1].strip())


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


def _spec(data: dict) -> PairSpec:
    s = data.get("stance") if data.get("stance") in ("bullish", "neutral", "cautious") else "neutral"
    z_entry = _cf(data.get("z_entry"), 1.0, 3.5, 2.0)
    z_exit = _cf(data.get("z_exit"), 0.0, 1.5, 0.5)
    if z_exit >= z_entry:                       # exit must be inside entry
        z_exit = max(0.0, z_entry - 1.0)
    stop_z = _cf(data.get("stop_z"), 2.5, 6.0, 4.0)
    if stop_z <= z_entry:
        stop_z = z_entry + 1.5
    return PairSpec(
        formation_window=_ci(data.get("formation_window"), 20, 252, 63),
        z_entry=z_entry, z_exit=z_exit, stop_z=stop_z,
        max_holding_days=_ci(data.get("max_holding_days"), 10, 180, 60),
        stance=s, thesis=str(data.get("thesis", ""))[:1200], rationale=str(data.get("rationale", ""))[:600])


async def author_pairs(*, trace_id: str, pair: str, readings_block: str, budget_usd: float) -> PairSpec:
    sys_t, user_t = _load("pairs_author")
    user = user_t.replace("{{pair}}", pair).replace("{{readings_block}}", readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task23.pairs_author", tier=Tier.DEFAULT, system=sys_t,
                       messages=[{"role": "user", "content": user}], max_tokens=600, temperature=0.2,
                       response_format="json", cache_system=True), trace_budget_usd=budget_usd)
    except Exception as e:  # noqa: BLE001
        logger.warning("task23_author_failed", error=str(e)[:200])
        return PairSpec(thesis=f"author unavailable ({type(e).__name__})", rationale="default 2.0/0.5/4.0 thresholds")
    data = resp.parsed_json
    if not isinstance(data, dict):
        return PairSpec(thesis="unparseable LLM output", rationale="default thresholds")
    spec = _spec(data)
    logger.info("task23_authored", z_entry=spec.z_entry, z_exit=spec.z_exit, window=spec.formation_window)
    return spec
