"""Task 8 orchestrator — ticker → earnings 8-Ks → classify → strategy → PEAD backtest.

Lookahead boundary is the most recent close (`as_of`); earnings events are keyed
off their 8-K filing date and act on the next open. Degrades gracefully: a ticker
with no US CIK (foreign filer) or no earnings 8-Ks still returns a buy-and-hold-
free baseline (no entries) with a loud caveat, rather than failing.
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
from task8_earnings.pipeline.autoresearch import author_earnings
from task8_earnings.pipeline.backtest import run_earnings_backtest
from task8_earnings.pipeline.classify import classify_events
from task8_earnings.pipeline.filings import fetch_earnings_releases
from task8_earnings.schemas import EarningsEvent, EarningsResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 200
_MAX_RELEASES = 12
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


def _readings(events: list[EarningsEvent], as_of: date) -> dict[str, float | str]:
    if not events:
        return {"earnings_regime": "no_releases", "n_events": 0.0}
    last = events[-1]
    n_bull = sum(1 for e in events if e.sentiment == "bullish")
    n_bear = sum(1 for e in events if e.sentiment == "bearish")
    n_raised = sum(1 for e in events if e.guidance == "raised")
    n_beat = sum(1 for e in events if e.beat_miss == "beat")
    recent4 = events[-4:]
    if sum(1 for e in recent4 if e.sentiment == "bullish") >= 3:
        regime = "consistently_bullish"
    elif sum(1 for e in recent4 if e.sentiment == "bearish") >= 2:
        regime = "weak"
    else:
        regime = "mixed"
    return {
        "earnings_regime": regime,
        "n_events": float(len(events)),
        "last_event_date": last.filing_date.isoformat(),
        "last_sentiment": last.sentiment,
        "last_guidance": last.guidance,
        "last_beat_miss": last.beat_miss,
        "n_bullish": float(n_bull),
        "n_bearish": float(n_bear),
        "n_raised_guidance": float(n_raised),
        "n_beats": float(n_beat),
        "days_since_last_earnings": float((as_of - last.filing_date).days),
    }


def _readings_block(r: dict[str, float | str]) -> str:
    order = ["earnings_regime", "n_events", "last_event_date", "last_sentiment",
             "last_guidance", "last_beat_miss", "n_bullish", "n_bearish",
             "n_raised_guidance", "n_beats", "days_since_last_earnings"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


async def run_earnings_pipeline(*, ticker: str, job_id: str | None = None) -> EarningsResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()

    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(f"price fetch for {ticker} timed out after 30s — Yahoo Finance is "
                           f"likely rate-limiting this host. Retry, or switch the price source.")
    except RuntimeError:
        raise TickerNotFound(f"Ticker '{ticker}' returned no price history. Use a US-listed ticker "
                             f"with a liquid price history (e.g. AAPL, MSFT, NVDA).")
    if len(prices) < _MIN_BARS:
        raise RuntimeError(f"only {len(prices)} trading days for {ticker} — too little to backtest.")
    as_of = prices[-1].date
    backtest_start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))

    market_prices = None if ticker == "SPY" else await _fetch_safe("SPY")

    # ----- resolve CIK + fetch earnings releases -----
    no_data = ""
    releases: list = []
    cik: int | None = None
    try:
        cik = (await fetch_sec_ticker_map()).get(ticker)
    except Exception as e:  # noqa: BLE001
        logger.warning("task8_ticker_map_failed", error=str(e)[:160])
    if cik is None:
        no_data = (f"{ticker} has no US SEC CIK (foreign filers don't file 8-K earnings releases) — "
                   f"no earnings data available.")
    else:
        try:
            releases, _ = await fetch_earnings_releases(
                cik, since=backtest_start - timedelta(days=120), max_filings=_MAX_RELEASES)
        except Exception as e:  # noqa: BLE001
            logger.warning("task8_releases_failed", error=str(e)[:200])
            no_data = f"earnings 8-K fetch failed for {ticker}: {type(e).__name__}."
        if not releases and not no_data:
            no_data = f"no earnings 8-Ks (Item 2.02) found for {ticker} in the window."

    # ----- classify (batched LLM) + readings + author -----
    events = await classify_events(trace_id=job_id, ticker=ticker, releases=releases,
                                   budget_usd=_LEG_BUDGET_USD) if releases else []
    readings = _readings(events, as_of)
    spec = await author_earnings(trace_id=job_id, ticker=ticker,
                                 readings_block=_readings_block(readings), as_of=as_of,
                                 budget_usd=_LEG_BUDGET_USD)

    backtest = run_earnings_backtest(prices, events, spec, start=backtest_start,
                                     transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)

    chart_from = backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)
    chart_prices = [p for p in prices if p.date >= chart_from]

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical post-earnings-drift backtest over the trailing ~3 years ending "
        f"{as_of.isoformat()} (window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage and market impact are not.",
        "Signal source: the earnings PRESS RELEASE filed as Exhibit 99.1 of an 8-K (Item 2.02), "
        "keyed off the FILING date so the backtest only acts once it was public. This is the "
        "prepared results + guidance — NOT the live earnings-call Q&A transcript (the source is "
        "pluggable; a paid transcript feed can replace it). Each release was classified by an LLM "
        "using only its own text; the strategy was then chosen from a fixed menu and executed "
        "deterministically — rule-based execution prevents lookahead.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY) over the same window.",
    ]
    if no_data:
        caveats.insert(1, f"⚠️ {no_data} No earnings entries fired — showing a flat baseline.")

    logger.info("task8_done", ticker=ticker, n_events=len(events), entry=spec.entry_signal,
                total_ret=backtest.metrics.total_return_pct,
                ms=int((time.perf_counter() - started) * 1000))

    return EarningsResult(
        job_id=job_id, ticker=ticker, company_name=ticker, cik=cik, as_of_date=as_of,
        n_releases=len(releases), events=events, prices=chart_prices, strategy=spec,
        backtest=backtest, earnings_readings=readings, caveats=caveats,
        cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc),
    )
