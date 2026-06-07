"""Autoresearch — the LLM that picks ONE cross-sectional ranking policy.

Input:  as-of universe stats (dispersion of momentum, vol, proximity-to-high),
        all trailing/lookahead-free.
Output: a validated `RankSpec` (factor + top_n + weighting + cadence + lookback).

The LLM never picks individual stocks — only the factor and how to hold the top
slice; the deterministic backtest ranks + selects. Falls back to a 12-1 momentum
default if the LLM is unavailable.
"""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task21_ranker.schemas import RankSpec

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task21_ranker"

_FACTORS = {"momentum_12_1", "low_volatility", "near_52w_high", "short_term_reversal"}
_METHODS = {"equal_weight", "inverse_vol"}
_REBAL = {"weekly", "monthly", "quarterly"}


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


def _spec_from_json(data: dict, n_names: int) -> RankSpec:
    factor = data.get("factor")
    if factor not in _FACTORS:
        factor = "momentum_12_1"
    method = data.get("weight_method")
    if method not in _METHODS:
        method = "equal_weight"
    rebalance = data.get("rebalance")
    if rebalance not in _REBAL:
        rebalance = "monthly"
    stance = data.get("stance")
    if stance not in ("bullish", "neutral", "cautious"):
        stance = "neutral"
    # hold at least 1, at most n-1 (so the basket is a strict subset → the factor matters)
    top_cap = max(1, n_names - 1)
    top_n = _clamp_int(data.get("top_n"), 1, top_cap, max(1, min(top_cap, n_names // 2)))
    return RankSpec(
        factor=factor,
        top_n=top_n,
        weight_method=method,
        rebalance=rebalance,
        lookback_days=_clamp_int(data.get("lookback_days"), 21, 252, 252),
        max_weight=max(1.0 / top_n, _clamp_float(data.get("max_weight"), 0.1, 1.0, 0.40)),
        stance=stance,
        thesis=str(data.get("thesis", ""))[:1200],
        rationale=str(data.get("rationale", ""))[:600],
    )


def _fallback_spec(n_names: int, reason: str) -> RankSpec:
    top_n = max(1, min(n_names - 1, n_names // 2 or 1))
    return RankSpec(
        factor="momentum_12_1", top_n=top_n, weight_method="equal_weight",
        rebalance="monthly", lookback_days=252, max_weight=max(1.0 / top_n, 0.40),
        stance="neutral",
        thesis=f"LLM ranking author unavailable ({reason}); defaulted to monthly "
               f"12-1 cross-sectional momentum, equal-weighting the top {top_n}.",
        rationale="Momentum is the most robust long-only cross-sectional factor.",
    )


async def author_rank(
    *, trace_id: str, n_names: int, readings_block: str, budget_usd: float,
) -> RankSpec:
    sys_t, user_t = _load_prompt("rank_author")
    user = _render(user_t, n_names=n_names, readings_block=readings_block)
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id, purpose="task21.rank_author", tier=Tier.DEFAULT,
                system=sys_t, messages=[{"role": "user", "content": user}],
                max_tokens=700, temperature=0.2, response_format="json", cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task21_author_failed", error=str(e)[:200])
        return _fallback_spec(n_names, type(e).__name__)

    data = resp.parsed_json
    if not isinstance(data, dict):
        return _fallback_spec(n_names, "unparseable LLM output")
    spec = _spec_from_json(data, n_names)
    logger.info("task21_policy_authored", factor=spec.factor, top_n=spec.top_n,
                method=spec.weight_method, rebalance=spec.rebalance)
    return spec
