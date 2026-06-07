"""Classify earnings releases → EarningsEvents, in ONE batched LLM call.

Each release is classified using ONLY its own text (sentiment / guidance /
beat-miss + a citation), so the labels are lookahead-free. Batching keeps it to a
single call regardless of how many releases there are. If the LLM is unavailable,
every event falls back to neutral (the backtest still runs `any_earnings`).
"""

from __future__ import annotations

import functools
from pathlib import Path

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger

from task8_earnings.pipeline.filings import EarningsRelease
from task8_earnings.schemas import EarningsEvent

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task8_earnings"
_PER_RELEASE_CHARS = 1500   # lead excerpt per release inside the batch

_SENT = {"bullish", "neutral", "bearish"}
_GUID = {"raised", "maintained", "lowered", "none"}
_BM = {"beat", "inline", "miss", "unknown"}


@functools.lru_cache(maxsize=4)
def _load_prompt(name: str) -> tuple[str, str]:
    text = (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    return (text.split("## System", 1)[1].split("## User template", 1)[0].strip(),
            text.split("## User template", 1)[1].strip())


def _neutral(releases: list[EarningsRelease]) -> list[EarningsEvent]:
    return [EarningsEvent(filing_date=r.filing_date) for r in releases]


async def classify_events(
    *, trace_id: str, ticker: str, releases: list[EarningsRelease], budget_usd: float,
) -> list[EarningsEvent]:
    if not releases:
        return []
    sys_t, user_t = _load_prompt("earnings_classify")
    blocks = []
    for i, r in enumerate(releases):
        blocks.append(f"[{i}] filed {r.filing_date.isoformat()}:\n{r.excerpt[:_PER_RELEASE_CHARS]}")
    user = user_t.replace("{{ticker}}", ticker).replace("{{releases_block}}", "\n\n".join(blocks))

    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace_id, purpose="task8.earnings_classify", tier=Tier.DEFAULT,
                system=sys_t, messages=[{"role": "user", "content": user}],
                max_tokens=1500, temperature=0.1, response_format="json", cache_system=True,
            ),
            trace_budget_usd=budget_usd,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task8_classify_failed", error=str(e)[:200])
        return _neutral(releases)

    data = resp.parsed_json
    rows = data.get("events") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return _neutral(releases)

    by_i: dict[int, dict] = {}
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("i"), int):
            by_i[row["i"]] = row

    out: list[EarningsEvent] = []
    for i, r in enumerate(releases):
        row = by_i.get(i, {})
        sent = row.get("sentiment") if row.get("sentiment") in _SENT else "neutral"
        guid = row.get("guidance") if row.get("guidance") in _GUID else "none"
        bm = row.get("beat_miss") if row.get("beat_miss") in _BM else "unknown"
        out.append(EarningsEvent(
            filing_date=r.filing_date, sentiment=sent, guidance=guid, beat_miss=bm,
            quote=str(row.get("quote", ""))[:300],
        ))
    logger.info("task8_classified", n=len(out),
                bullish=sum(1 for e in out if e.sentiment == "bullish"))
    return out
