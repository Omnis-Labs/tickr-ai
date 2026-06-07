"""Per-name signal extraction for the portfolio agent.

For each ticker we reuse the Task 4 technical agent end-to-end: author a strategy
from as-of readings, backtest it over the common window, and derive a daily
long/flat series from its trades (via Task 5's `inmarket_by_date`). The portfolio
layer then sizes across these per-name series. This keeps the per-name signal
identical to what the standalone Task 4 agent would produce.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from shared.logging import get_logger
from task4_technical.pipeline.autoresearch import author_technical
from task4_technical.pipeline.backtest import run_backtest as run_tech_backtest
from task4_technical.pipeline.indicators import indicator_readings_asof
from task4_technical.schemas import PricePoint
from task5_ensemble.pipeline.combine import inmarket_by_date

logger = get_logger(__name__)

# Fundamental-conviction → sizing score for `signal_proportional`.
_STANCE_SCORE = {"bullish": 1.0, "neutral": 0.5, "cautious": 0.25}


@dataclass
class NameSignal:
    ticker: str
    available: bool
    stance: str | None = None
    entry_signal: str | None = None
    exit_signal: str | None = None
    score: float = 0.5
    closes: list[float] = field(default_factory=list)      # aligned to the common axis
    in_market: list[bool] = field(default_factory=list)    # aligned to the common axis
    standalone_return_pct: float | None = None
    note: str = ""


async def build_name_signal(
    *, job_id: str, ticker: str, prices: list[PricePoint], common_start: date,
    as_of: date, common_dates: list[date], market_prices: list[PricePoint] | None,
    budget_usd: float,
) -> NameSignal:
    """Author the T4 strategy for one name and project it onto the common axis."""
    close_map = {p.date: p.close for p in prices}
    # aligned closes (carry forward the rare missing date so the axis stays dense)
    closes: list[float] = []
    last = None
    for d in common_dates:
        if d in close_map:
            last = close_map[d]
        closes.append(last if last is not None else 0.0)

    try:
        readings = indicator_readings_asof(prices, as_of)
        spec = await author_technical(
            trace_id=job_id, ticker=ticker, company=ticker,
            prices=prices, as_of=as_of, readings=readings, budget_usd=budget_usd,
        )
        bt = run_tech_backtest(prices, spec, start=common_start,
                               transaction_cost_bps=10.0, market_prices=market_prices)
        flags = inmarket_by_date(bt.trades, common_dates)
        return NameSignal(
            ticker=ticker, available=True, stance=spec.stance,
            entry_signal=spec.entry_signal, exit_signal=spec.exit_signal,
            score=_STANCE_SCORE.get(spec.stance, 0.5),
            closes=closes, in_market=[flags[d] for d in common_dates],
            standalone_return_pct=bt.metrics.total_return_pct,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("task10_name_signal_failed", ticker=ticker, error=str(e)[:160])
        return NameSignal(
            ticker=ticker, available=False, closes=closes,
            in_market=[False] * len(common_dates),
            note=f"signal unavailable ({type(e).__name__})",
        )
