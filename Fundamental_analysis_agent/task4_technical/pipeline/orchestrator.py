"""Task 4 orchestrator — ticker → technical readings → strategy → backtest.

Unlike Task 3 there is no 10-K and no filing date. The lookahead boundary is the
most recent close (`as_of`): the LLM only ever sees indicator readings computed
on/before that bar, and the backtest runs over a fixed trailing window ending at
`as_of`. The strategy is *selected now* and *evaluated on the trailing window that
led up to now* — rule-based execution still prevents future prices from leaking
into the result.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task3_strategy.pipeline.prices import fetch_prices  # reused as-is (ticker-only)
from task4_technical.pipeline.autoresearch import author_technical
from task4_technical.pipeline.backtest import run_backtest
from task4_technical.pipeline.indicators import indicator_readings_asof
from task4_technical.schemas import TechnicalResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365            # pre-window context shown on the candlestick
_BACKTEST_LOOKBACK_DAYS = 365 * 3     # trailing window we backtest over
_MIN_BARS = 200                       # need enough history for SMA200 + a window


class TickerNotFound(ValueError):
    """Raised when the ticker resolves to no usable price history."""


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def run_technical_pipeline(*, ticker: str, job_id: str | None = None) -> TechnicalResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()

    # ----- prices -----
    # yfinance is a BLOCKING network call — run it off the event loop so it can't
    # freeze the server (incl. the poll endpoint), and bound it so a Yahoo
    # rate-limit on a cloud IP fails fast instead of hanging forever.
    try:
        prices = await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"price fetch for {ticker} timed out after 30s — Yahoo Finance is "
            f"likely rate-limiting this host. Retry, or switch the price source."
        )
    except RuntimeError:
        # fetch_prices raises RuntimeError("no price data for ...") on a bad/delisted ticker
        raise TickerNotFound(
            f"Ticker '{ticker}' returned no price history. Use a US-listed ticker "
            f"with a liquid price history (e.g. AAPL, MSFT, NVDA)."
        )
    if len(prices) < _MIN_BARS:
        raise RuntimeError(
            f"only {len(prices)} trading days of price history for {ticker} — "
            f"too little for a technical backtest (need ≥ {_MIN_BARS})."
        )

    as_of = prices[-1].date
    logger.info("task4_resolved", ticker=ticker, as_of=as_of.isoformat(), bars=len(prices))

    # ----- indicator readings (strictly as-of `as_of`) -----
    readings = indicator_readings_asof(prices, as_of)

    # ----- author the strategy (LLM, grounded in the readings) -----
    spec = await author_technical(
        trace_id=job_id, ticker=ticker, company=ticker,
        prices=prices, as_of=as_of, readings=readings, budget_usd=0.10,
    )

    # ----- market benchmark (S&P 500 via SPY) — best-effort, never fatal -----
    market_prices = None
    if ticker != "SPY":
        try:
            market_prices = await asyncio.wait_for(asyncio.to_thread(fetch_prices, "SPY"), timeout=30)
        except Exception as e:  # noqa: BLE001
            logger.warning("task4_spy_fetch_failed", error=str(e)[:160])

    # ----- backtest over the trailing window (lookahead-aligned to its start) ---
    backtest_start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))
    backtest = run_backtest(
        prices, spec, start=backtest_start,
        transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices,
    )

    # trim the prices we ship to the chart: ~1y of pre-window context + the window
    chart_from = backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)
    chart_prices = [p for p in prices if p.date >= chart_from]

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage and market impact are not.",
        "The LLM selected the strategy and parameters from a fixed technical menu using ONLY "
        "indicator readings as-of the decision date; execution is fully deterministic. Rule-based "
        "execution prevents future prices from leaking into the result, but the strategy *selection* "
        "could still reflect the model's prior knowledge of this ticker — treat it as a hypothesis, "
        "not a prediction.",
        "Benchmarks shown: buy-and-hold over the full window (charges the strategy for the indicator "
        "warm-up period when it cannot yet trade); buy-and-hold from the strategy's first entry "
        "(isolates timing/signal quality from that warm-up cash drag); and the S&P 500 (SPY) over the "
        "same window — 'alpha vs market' is the strategy's return minus the market's.",
    ]
    logger.info(
        "task4_done", ticker=ticker, entry=spec.entry_signal,
        total_ret=backtest.metrics.total_return_pct, bench=backtest.metrics.benchmark_return_pct,
        ms=int((time.perf_counter() - started) * 1000),
    )

    return TechnicalResult(
        job_id=job_id,
        ticker=ticker,
        company_name=ticker,
        as_of_date=as_of,
        prices=chart_prices,
        strategy=spec,
        backtest=backtest,
        indicator_readings=readings,
        caveats=caveats,
        cost_usd=round(cost, 6),
        created_at=datetime.now(timezone.utc),
    )
