"""Task 16 orchestrator — ticker → FINRA short-volume → squeeze rule → backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task16_short.pipeline.autoresearch import author_short
from task16_short.pipeline.backtest import readings_block, run_short_backtest, short_readings
from task16_short.pipeline.finra import fetch_short_volume_series
from task16_short.schemas import ShortResult

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 2     # short-volume window (bounds the FINRA fetch)
_MIN_BARS = 200
_LEG_BUDGET_USD = 0.10


class TickerNotFound(ValueError):
    pass


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch(t: str) -> list:
    return await asyncio.wait_for(asyncio.to_thread(fetch_prices, t), timeout=30)


async def _safe(t: str) -> list | None:
    try:
        return await _fetch(t)
    except Exception:  # noqa: BLE001
        return None


async def run_short_pipeline(*, ticker: str, job_id: str | None = None) -> ShortResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()
    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(f"price fetch for {ticker} timed out after 30s — retry.")
    except RuntimeError:
        raise TickerNotFound(f"Ticker '{ticker}' returned no price history. Use a US-listed ticker "
                             f"(e.g. AAPL, MSFT, NVDA).")
    if len(prices) < _MIN_BARS:
        raise RuntimeError(f"only {len(prices)} trading days for {ticker} — too little.")
    as_of = prices[-1].date
    backtest_start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))
    market_prices = None if ticker == "SPY" else await _safe("SPY")

    no_data = ""
    svr = []
    try:
        svr = await fetch_short_volume_series(ticker, since=backtest_start - timedelta(days=30), as_of=as_of)
    except Exception as e:  # noqa: BLE001
        logger.warning("task16_finra_failed", error=str(e)[:200])
        no_data = f"FINRA short-volume fetch failed for {ticker}: {type(e).__name__}."
    if not svr and not no_data:
        no_data = f"no FINRA short-volume data found for {ticker} (not NMS-listed?)."

    readings = short_readings(svr)
    spec = await author_short(trace_id=job_id, ticker=ticker, readings_block=readings_block(readings),
                              budget_usd=_LEG_BUDGET_USD)
    backtest = run_short_backtest(prices, svr, spec, start=backtest_start,
                                  transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~2 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Signal source: FINRA daily SHORT-VOLUME (regsho), weekly-sampled & cached, used with a "
        "publish lag (lookahead-safe). ⚠️ This is short VOLUME (% of daily volume sold short), NOT "
        "short INTEREST (outstanding shorts), and it INCLUDES market-maker hedging — so a high ratio "
        "is a pressure gauge, not a clean bearish/squeeze signal. Free historical short-interest is "
        "not available, hence this proxy.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    if no_data:
        caveats.insert(1, f"⚠️ {no_data} No short-pressure entries fired — flat baseline.")
    logger.info("task16_done", ticker=ticker, n=len(svr), entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000))
    return ShortResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of, n_samples=len(svr),
                       prices=chart, strategy=spec, backtest=backtest, short_readings=readings, caveats=caveats,
                       cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
