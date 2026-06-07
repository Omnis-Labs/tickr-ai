"""Task 9 orchestrator — ticker → curated funds' 13F holdings → strategy → backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map, fetch_submissions
from task3_strategy.pipeline.prices import fetch_prices
from task9_institutional.pipeline.autoresearch import author_institutional
from task9_institutional.pipeline.backtest import run_institutional_backtest
from task9_institutional.pipeline.funds import TRACKED_FUNDS, fetch_fund_holdings
from task9_institutional.pipeline.holdings import (
    build_series,
    fund_summaries,
    n_funds_holding_asof,
    readings_asof,
    readings_block,
)
from task9_institutional.schemas import InstitutionalResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 200
_MAX_PER_FUND = 10
_DEFAULT_LB = 180
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


async def run_institutional_pipeline(*, ticker: str, job_id: str | None = None) -> InstitutionalResult:
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

    # ----- resolve CIK + official company name -----
    no_data = ""
    cik: int | None = None
    company_name = ticker
    try:
        cik = (await fetch_sec_ticker_map()).get(ticker)
        if cik is not None:
            company_name = (await fetch_submissions(cik)).get("name", ticker) or ticker
    except Exception as e:  # noqa: BLE001
        logger.warning("task9_resolve_failed", error=str(e)[:160])
    if cik is None:
        no_data = f"{ticker} has no US SEC CIK — can't name-match it in 13F filings."

    # ----- fetch tracked-fund holdings -----
    holdings = []
    n_tracked = len(TRACKED_FUNDS)
    if cik is not None:
        try:
            holdings, n_tracked = await fetch_fund_holdings(
                company_name, since=backtest_start - timedelta(days=365),
                max_filings_per_fund=_MAX_PER_FUND)
        except Exception as e:  # noqa: BLE001
            logger.warning("task9_holdings_failed", error=str(e)[:200])
            no_data = f"13F fetch failed for {ticker}: {type(e).__name__}."
        if not holdings and not no_data:
            no_data = f"none of the {n_tracked} tracked funds hold {company_name} in the window."

    series = build_series(holdings)
    readings = readings_asof(series, as_of, _DEFAULT_LB)
    spec = await author_institutional(trace_id=job_id, ticker=ticker,
                                      readings_block=readings_block(readings), as_of=as_of,
                                      budget_usd=_LEG_BUDGET_USD)

    backtest = run_institutional_backtest(prices, holdings, spec, start=backtest_start,
                                          transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)

    chart_from = backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)
    chart_prices = [p for p in prices if p.date >= chart_from]
    summaries = [s for s in fund_summaries(series, as_of) if s.latest_shares > 0]

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage and market impact are not.",
        f"Signal source: SEC 13F-HR holdings of {n_tracked} curated well-known managers (Berkshire, "
        f"Baupost, Pershing Square, …) — NOT total institutional ownership. Keyed off the 13F FILING "
        f"date (~45 days after quarter end), so it is lookahead-safe but SLOW (a confirmation/context "
        f"signal, not a timing edge). Holdings are matched to the company by issuer NAME (13F has no "
        f"ticker), which can be fuzzy for similarly-named issuers. Fund coverage is best-effort: "
        f"each run makes many SEC requests, and a fund whose filings get rate-limited is skipped "
        f"(retried first), so coverage can undercount under heavy load.",
        "The LLM chose the strategy from a fixed menu using ONLY as-of readings; execution is "
        "deterministic and rule-based, preventing lookahead.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    if no_data:
        caveats.insert(1, f"⚠️ {no_data} No 13F entries fired — showing a flat baseline.")

    logger.info("task9_done", ticker=ticker, n_holders=n_funds_holding_asof(series, as_of),
                entry=spec.entry_signal, total_ret=backtest.metrics.total_return_pct,
                ms=int((time.perf_counter() - started) * 1000))

    return InstitutionalResult(
        job_id=job_id, ticker=ticker, company_name=company_name, cik=cik, as_of_date=as_of,
        n_funds_tracked=n_tracked, n_funds_holding=n_funds_holding_asof(series, as_of),
        funds=summaries, prices=chart_prices, strategy=spec, backtest=backtest,
        institutional_readings=readings, caveats=caveats,
        cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc),
    )
