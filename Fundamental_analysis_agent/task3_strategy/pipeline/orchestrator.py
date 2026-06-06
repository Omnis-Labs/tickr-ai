"""Task 3 orchestrator — ticker → 10-K → strategy → filing-date-aligned backtest.

Reliability contract (inherited from Task 2 / ADR-007): if the 10-K extraction
is **quarantined**, we refuse to author a strategy. A trading thesis built on
fundamentals we could not reliably extract would be exactly the kind of
confident-looking-but-wrong output the quarantine gate exists to prevent.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task2_10k_extractor.eval.edgar_lookup import resolve_filing
from task2_10k_extractor.pipeline.orchestrator import run_pipeline
from task3_strategy.pipeline.autoresearch import author_strategy
from task3_strategy.pipeline.backtest import run_backtest
from task3_strategy.pipeline.prices import fetch_prices
from task3_strategy.schemas import StrategyResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365  # how much pre-filing context to show on the candlestick
_MIN_POST_FILING_BARS = 30


class QuarantineRefusal(RuntimeError):
    """Raised when the underlying 10-K extraction was quarantined."""


class TickerNotFound(ValueError):
    """Raised when the ticker resolves to no US 10-K filer."""


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def run_strategy_pipeline(*, ticker: str, job_id: str | None = None) -> StrategyResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()

    # ----- resolve the most recent 10-K -----
    try:
        ref = await resolve_filing(ticker)
    except KeyError:
        raise TickerNotFound(
            f"Ticker '{ticker}' not found. Use a US-listed ticker that files a "
            f"10-K (e.g. AAPL, MSFT, NVDA). Foreign filers that file 20-F instead "
            f"of 10-K are not supported."
        )
    filing_date = date.fromisoformat(ref.filed_date)
    logger.info("task3_resolved", ticker=ticker, fy=ref.fiscal_year, filed=ref.filed_date)

    # ----- Task 2 extraction (with the structural gate) -----
    # Skip L3 here: it adds ~20s of sequential LLM calls but rarely recovers a
    # core item, and Task 3 only needs the core items (L1) + the quarantine gate.
    extraction = await run_pipeline(url=ref.url, job_id=job_id, enable_l3=False)
    if extraction.quarantined:
        raise QuarantineRefusal(
            f"10-K extraction for {ticker} (FY{ref.fiscal_year}) was quarantined "
            f"({'; '.join(extraction.quarantine_reasons[:3])}). Refusing to build a "
            f"strategy on fundamentals we could not reliably extract."
        )

    # ----- prices -----
    # yfinance is a BLOCKING network call — run it off the event loop so it
    # can't freeze the whole server (incl. the poll endpoint), and bound it so
    # a Yahoo rate-limit on a cloud IP fails fast instead of hanging forever.
    try:
        prices = await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"price fetch for {ticker} timed out after 30s — Yahoo Finance is "
            f"likely rate-limiting this host. Retry, or switch the price source."
        )
    if not prices:
        raise RuntimeError(f"no price history for {ticker}")
    first_px, last_px = prices[0].date, prices[-1].date
    available = max(filing_date, first_px)
    post = [p for p in prices if p.date >= available]
    if len(post) < _MIN_POST_FILING_BARS:
        raise RuntimeError(
            f"only {len(post)} trading days of price history after the filing date "
            f"({available}) — too little to backtest meaningfully."
        )

    # ----- author the strategy (LLM) -----
    spec = await author_strategy(
        trace_id=job_id, ticker=ticker, extraction=extraction,
        prices=prices, filing_date=available, budget_usd=0.10,
    )

    # ----- market benchmark (S&P 500 via SPY) — best-effort, never fatal -----
    market_prices = None
    if ticker != "SPY":
        try:
            market_prices = await asyncio.wait_for(asyncio.to_thread(fetch_prices, "SPY"), timeout=30)
        except Exception as e:  # noqa: BLE001
            logger.warning("task3_spy_fetch_failed", error=str(e)[:160])

    # ----- backtest (deterministic, lookahead-aligned to `available`) -----
    backtest = run_backtest(
        prices, spec, start=available,
        transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices,
    )

    # trim the prices we ship to the chart: ~1y of pre-filing context + the test window
    chart_from = available - timedelta(days=_CHART_LOOKBACK_DAYS)
    chart_prices = [p for p in prices if p.date >= chart_from]

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest, lookahead-aligned to the 10-K filing date ({available.isoformat()}): "
        f"signals only act on or after that date. Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage and market impact are not.",
        "The LLM selected the strategy and parameters from a fixed menu; execution is fully deterministic. "
        "Rule-based execution prevents future prices from leaking into the result, but the strategy *selection* "
        "could still reflect the model's prior knowledge — treat the thesis as a hypothesis, not a prediction.",
        "Benchmarks shown: buy-and-hold over the full window (from the filing date — charges the "
        "strategy for the indicator warm-up period when it cannot yet trade); buy-and-hold from "
        "the strategy's first entry (isolates timing/signal quality from that warm-up cash drag); "
        "and the S&P 500 (SPY) over the same window — 'alpha vs market' is the strategy's return "
        "minus the market's, i.e. whether it beat the broad market, not just the stock.",
    ]
    logger.info(
        "task3_done", ticker=ticker, entry=spec.entry_signal,
        total_ret=backtest.metrics.total_return_pct, bench=backtest.metrics.benchmark_return_pct,
        ms=int((time.perf_counter() - started) * 1000),
    )

    return StrategyResult(
        job_id=job_id,
        ticker=ticker,
        company_name=extraction.filing.company_name or ticker,
        filing_url=ref.url,
        fiscal_year=ref.fiscal_year,
        filing_available_date=available,
        prices=chart_prices,
        strategy=spec,
        backtest=backtest,
        caveats=caveats,
        cost_usd=round(cost, 6),
        created_at=datetime.now(timezone.utc),
    )
