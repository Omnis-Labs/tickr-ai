"""Task 6 orchestrator — ticker → Form 4 insider flow → strategy → backtest.

The lookahead boundary is the most recent close (`as_of`): the LLM only sees
insider-flow readings built from Form 4s *filed* on/before that date, and the
backtest runs over a fixed trailing window ending at `as_of`, acting on each
signal at the next bar's open.

Graceful degradation: a ticker with no US SEC CIK (e.g. a foreign ADR) or with no
open-market insider activity still returns a result — a buy-and-hold baseline with
a loud caveat — rather than failing, so the page never dead-ends.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map
from task3_strategy.pipeline.prices import fetch_prices
from task6_insider.pipeline.autoresearch import author_insider
from task6_insider.pipeline.backtest import run_insider_backtest
from task6_insider.pipeline.forms import fetch_form4_txns
from task6_insider.pipeline.signals import insider_readings_asof
from task6_insider.schemas import InsiderResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 200
_DEFAULT_READING_LOOKBACK = 90
_FORM4_MAX_FILINGS = 150
_LEG_BUDGET_USD = 0.10


class TickerNotFound(ValueError):
    """Raised when the ticker resolves to no usable price history."""


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch_prices(ticker: str) -> list:
    return await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)


async def run_insider_pipeline(*, ticker: str, job_id: str | None = None) -> InsiderResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()

    # ----- prices -----
    try:
        prices = await _fetch_prices(ticker)
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
    logger.info("task6_resolved", ticker=ticker, as_of=as_of.isoformat(), bars=len(prices))

    # ----- market benchmark (SPY) — best-effort -----
    market_prices = None
    if ticker != "SPY":
        try:
            market_prices = await _fetch_prices("SPY")
        except Exception as e:  # noqa: BLE001
            logger.warning("task6_spy_fetch_failed", error=str(e)[:160])

    # ----- resolve CIK + fetch Form 4 transactions -----
    no_data_reason = ""
    txns: list = []
    n_filings = 0
    capped = False
    cik: int | None = None
    try:
        tmap = await fetch_sec_ticker_map()
        cik = tmap.get(ticker)
    except Exception as e:  # noqa: BLE001
        logger.warning("task6_ticker_map_failed", error=str(e)[:160])
    if cik is None:
        no_data_reason = (
            f"{ticker} has no US SEC CIK (foreign filers file Form 20-F, not Form 4) — "
            f"no insider data available."
        )
    else:
        # fetch a generous buffer before the window so the trailing flow at the
        # window start already has filings to look back over.
        since = backtest_start - timedelta(days=365)
        try:
            txns, n_filings, capped = await fetch_form4_txns(
                cik, since=since, max_filings=_FORM4_MAX_FILINGS
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("task6_form4_fetch_failed", error=str(e)[:200])
            no_data_reason = f"Form 4 fetch failed for {ticker}: {type(e).__name__}."
        if not txns and not no_data_reason:
            no_data_reason = f"No open-market Form 4 insider transactions found for {ticker} in the window."

    # ----- as-of readings + author the strategy -----
    readings = insider_readings_asof(txns, as_of, _DEFAULT_READING_LOOKBACK)
    spec = await author_insider(
        trace_id=job_id, ticker=ticker, company=ticker,
        readings=readings, as_of=as_of, budget_usd=_LEG_BUDGET_USD,
    )

    # ----- backtest -----
    backtest = run_insider_backtest(
        prices, txns, spec, start=backtest_start,
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
        "Signal source: SEC Form 4 open-market insider transactions, keyed off the FILING date "
        "(not the trade date) so the backtest only acts once a filing was public. Only open-market "
        "buys (code P) and sales (code S) are used; grants, option exercises, tax withholding and "
        "gifts are excluded as non-discretionary. Insider SELLING is treated as a weak/exit signal "
        "only — insiders sell for many non-bearish reasons.",
        "The LLM selected the strategy and parameters from a fixed menu using ONLY as-of readings; "
        "execution is deterministic. Rule-based execution prevents lookahead, but the strategy "
        "*selection* could still reflect the model's prior knowledge — treat it as a hypothesis.",
    ]
    if no_data_reason:
        caveats.insert(1, f"⚠️ {no_data_reason} Showing a buy-and-hold baseline.")
    if capped:
        caveats.append(
            f"Form 4 fetch was capped at {_FORM4_MAX_FILINGS} most-recent filings (or older "
            f"filings exist beyond the SEC 'recent' block) — the earliest part of the window may "
            f"undercount insider activity."
        )

    logger.info(
        "task6_done", ticker=ticker, entry=spec.entry_signal, n_txns=len(txns),
        total_ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000),
    )

    return InsiderResult(
        job_id=job_id,
        ticker=ticker,
        company_name=ticker,
        cik=cik,
        as_of_date=as_of,
        n_form4_filings=n_filings,
        n_transactions=len(txns),
        fetch_capped=capped,
        prices=chart_prices,
        strategy=spec,
        backtest=backtest,
        insider_readings=readings,
        caveats=caveats,
        cost_usd=round(cost, 6),
        created_at=datetime.now(timezone.utc),
    )
