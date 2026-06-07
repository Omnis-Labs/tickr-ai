"""Task 12 orchestrator — ticker → seasonality stats → calendar strategy → backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task3_strategy.pipeline.prices import fetch_prices
from task12_seasonality.pipeline.autoresearch import author_seasonal
from task12_seasonality.pipeline.backtest import run_seasonal_backtest
from task12_seasonality.pipeline.signals import readings_block, seasonal_readings
from task12_seasonality.schemas import SeasonalResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 5     # seasonality wants more history
_MIN_BARS = 300
_LEG_BUDGET_USD = 0.10


class TickerNotFound(ValueError):
    pass


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch(ticker: str) -> list:
    return await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)


async def _fetch_safe(ticker: str) -> list | None:
    try:
        return await _fetch(ticker)
    except Exception:  # noqa: BLE001
        return None


async def run_seasonal_pipeline(*, ticker: str, job_id: str | None = None) -> SeasonalResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()
    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(f"price fetch for {ticker} timed out after 30s — retry or switch source.")
    except RuntimeError:
        raise TickerNotFound(f"Ticker '{ticker}' returned no price history. Use a US-listed ticker "
                             f"(e.g. AAPL, MSFT, NVDA).")
    if len(prices) < _MIN_BARS:
        raise RuntimeError(f"only {len(prices)} trading days for {ticker} — too little for seasonality.")
    as_of = prices[-1].date
    backtest_start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))
    market_prices = None if ticker == "SPY" else await _fetch_safe("SPY")

    readings = seasonal_readings(prices)
    spec = await author_seasonal(trace_id=job_id, ticker=ticker,
                                 readings_block=readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    backtest = run_seasonal_backtest(prices, spec, start=backtest_start,
                                     transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    chart_prices = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~5 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage and market impact are not.",
        "⚠️ Seasonality is estimated IN-SAMPLE over history — the weakest form of edge and prone to "
        "overfitting. The calendar RULE itself is lookahead-free (you know the calendar in advance), "
        "but the *choice* of which months/effect to trade reflects patterns in the same data — treat "
        "the result as illustrative, not a robust forecast.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task12_done", ticker=ticker, entry=spec.entry_signal,
                total_ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000))
    return SeasonalResult(
        job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of, prices=chart_prices,
        strategy=spec, backtest=backtest, seasonality_readings=readings, caveats=caveats,
        cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc),
    )
