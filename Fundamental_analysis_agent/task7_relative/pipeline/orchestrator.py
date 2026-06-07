"""Task 7 orchestrator — ticker → sector benchmark → relative-strength → strategy → backtest.

Lookahead boundary is the most recent close (`as_of`): the LLM sees RS readings
built only from bars on/before it, the backtest runs over a trailing window ending
at `as_of`, and signals act on the next bar's open. Degrades gracefully: if the
sector ETF can't be fetched it falls back to SPY (relative-to-market); if even that
fails, RS signals simply never fire and a buy-and-hold baseline is shown.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task3_strategy.pipeline.prices import fetch_prices
from task7_relative.pipeline.autoresearch import author_relative
from task7_relative.pipeline.backtest import run_relative_backtest
from task7_relative.pipeline.benchmarks import resolve_sector_etf
from task7_relative.pipeline.indicators import relative_readings_asof
from task7_relative.schemas import RelativeResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 200
_RS_SMA = 50
_LEG_BUDGET_USD = 0.10


class TickerNotFound(ValueError):
    """Raised when the ticker resolves to no usable price history."""


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch(ticker: str) -> list:
    return await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)


async def _fetch_safe(ticker: str) -> list | None:
    try:
        return await _fetch(ticker)
    except Exception as e:  # noqa: BLE001
        logger.warning("task7_bench_fetch_failed", ticker=ticker, error=str(e)[:160])
        return None


async def run_relative_pipeline(*, ticker: str, job_id: str | None = None) -> RelativeResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()

    # ----- ticker prices -----
    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"price fetch for {ticker} timed out after 30s — Yahoo Finance is likely "
            f"rate-limiting this host. Retry, or switch the price source."
        )
    except RuntimeError:
        raise TickerNotFound(
            f"Ticker '{ticker}' returned no price history. Use a US-listed ticker with a "
            f"liquid price history (e.g. AAPL, MSFT, NVDA)."
        )
    if len(prices) < _MIN_BARS:
        raise RuntimeError(
            f"only {len(prices)} trading days of price history for {ticker} — too little "
            f"for a backtest (need ≥ {_MIN_BARS})."
        )
    as_of = prices[-1].date
    backtest_start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))

    # ----- resolve sector ETF, then fetch benchmark + market prices -----
    sector_etf, sector_label = await resolve_sector_etf(ticker)
    logger.info("task7_resolved", ticker=ticker, as_of=as_of.isoformat(),
                bars=len(prices), benchmark=sector_etf)

    spy = None if ticker == "SPY" else await _fetch_safe("SPY")
    if sector_etf == "SPY":
        bench_prices = spy or []
    else:
        bench_prices = await _fetch_safe(sector_etf) or []
    market_prices = spy
    if not bench_prices:
        # couldn't fetch the sector benchmark — fall back to the market (or empty)
        bench_prices = spy or []
        sector_label = sector_label if bench_prices else f"{sector_label} (unavailable)"

    # ----- as-of readings + author -----
    readings = relative_readings_asof(
        prices, bench_prices, market_prices, sector_label=sector_label, rs_sma=_RS_SMA,
    )
    spec = await author_relative(
        trace_id=job_id, ticker=ticker, company=ticker, sector_label=sector_label,
        readings=readings, as_of=as_of, budget_usd=_LEG_BUDGET_USD,
    )

    # ----- backtest -----
    backtest = run_relative_backtest(
        prices, bench_prices, spec, start=backtest_start,
        transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices,
    )

    chart_from = backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)
    chart_prices = [p for p in prices if p.date >= chart_from]

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage and market impact are not.",
        f"Relative strength is measured vs {sector_label} ({sector_etf}); the position is in the "
        f"stock itself (long/flat) and RS only decides WHEN to be long. The sector benchmark is "
        f"derived from the filer's SIC code, falling back to the S&P 500 when it can't be classified.",
        "The LLM selected the strategy from a fixed menu using ONLY as-of RS readings; execution is "
        "deterministic. Rule-based execution prevents lookahead, but the *selection* could reflect "
        "the model's prior knowledge — treat it as a hypothesis.",
    ]

    logger.info(
        "task7_done", ticker=ticker, entry=spec.entry_signal, benchmark=sector_etf,
        total_ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000),
    )

    return RelativeResult(
        job_id=job_id,
        ticker=ticker,
        company_name=ticker,
        as_of_date=as_of,
        sector_etf=sector_etf,
        sector_label=sector_label,
        prices=chart_prices,
        strategy=spec,
        backtest=backtest,
        relative_readings=readings,
        caveats=caveats,
        cost_usd=round(cost, 6),
        created_at=datetime.now(timezone.utc),
    )
