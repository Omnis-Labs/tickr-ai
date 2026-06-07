"""Task 11 orchestrator — ticker → XBRL quarterly fundamentals → strategy → backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map, fetch_submissions
from task3_strategy.pipeline.prices import fetch_prices
from task11_fundamentals_trend.pipeline.autoresearch import author_fundtrend
from task11_fundamentals_trend.pipeline.backtest import run_fundtrend_backtest
from task11_fundamentals_trend.pipeline.companyfacts import extract_quarters, fetch_companyfacts
from task11_fundamentals_trend.pipeline.signals import readings_asof, readings_block
from task11_fundamentals_trend.schemas import FundTrendResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 200
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
    except Exception:  # noqa: BLE001
        return None


async def run_fundtrend_pipeline(*, ticker: str, job_id: str | None = None) -> FundTrendResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()

    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(f"price fetch for {ticker} timed out after 30s — Yahoo is likely "
                           f"rate-limiting this host. Retry, or switch the price source.")
    except RuntimeError:
        raise TickerNotFound(f"Ticker '{ticker}' returned no price history. Use a US-listed ticker "
                             f"with a liquid price history (e.g. AAPL, MSFT, NVDA).")
    if len(prices) < _MIN_BARS:
        raise RuntimeError(f"only {len(prices)} trading days for {ticker} — too little to backtest.")
    as_of = prices[-1].date
    backtest_start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))

    market_prices = None if ticker == "SPY" else await _fetch_safe("SPY")

    # ----- resolve CIK + company name, fetch XBRL fundamentals -----
    no_data = ""
    cik: int | None = None
    company_name = ticker
    quarters = []
    try:
        cik = (await fetch_sec_ticker_map()).get(ticker)
        if cik is not None:
            company_name = (await fetch_submissions(cik)).get("name", ticker) or ticker
            quarters = extract_quarters(await fetch_companyfacts(cik))
    except Exception as e:  # noqa: BLE001
        logger.warning("task11_xbrl_failed", error=str(e)[:200])
        no_data = f"XBRL fundamentals unavailable for {ticker}: {type(e).__name__}."
    if cik is None:
        no_data = f"{ticker} has no US SEC CIK (foreign filers don't file XBRL us-gaap) — no fundamentals."
    elif not quarters and not no_data:
        no_data = f"no quarterly XBRL fundamentals found for {ticker}."

    readings = readings_asof(quarters, as_of)
    spec = await author_fundtrend(trace_id=job_id, ticker=ticker,
                                  readings_block=readings_block(readings), as_of=as_of,
                                  budget_usd=_LEG_BUDGET_USD)

    backtest = run_fundtrend_backtest(prices, quarters, spec, start=backtest_start,
                                      transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)

    chart_from = backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)
    chart_prices = [p for p in prices if p.date >= chart_from]
    recent_q = [q for q in quarters if q.filed <= as_of][-8:]

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage and market impact are not.",
        "Signal source: SEC XBRL companyfacts (reported revenue / gross profit / net income), keyed "
        "off the FILING date and using the AS-ORIGINALLY-FILED value per period (point-in-time, so "
        "later restatements don't leak in). YoY growth is matched to the same fiscal quarter a year "
        "earlier. This is a SLOW (quarterly) signal — fundamental momentum, not a fast trade.",
        "The LLM chose the strategy from a fixed menu using ONLY as-of readings; execution is "
        "deterministic, preventing lookahead.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    if no_data:
        caveats.insert(1, f"⚠️ {no_data} No entries fired — showing a flat baseline.")

    logger.info("task11_done", ticker=ticker, n_quarters=len(quarters), entry=spec.entry_signal,
                total_ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000))

    return FundTrendResult(
        job_id=job_id, ticker=ticker, company_name=company_name, cik=cik, as_of_date=as_of,
        n_quarters=len(quarters), quarters=recent_q, prices=chart_prices, strategy=spec,
        backtest=backtest, fundamentals_readings=readings, caveats=caveats,
        cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc),
    )
