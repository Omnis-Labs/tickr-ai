"""Task 18 orchestrator — ticker → corporate events → event-driven rule → backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map, fetch_submissions
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest   # reused generic factor backtest
from task18_events.pipeline.autoresearch import author_events
from task18_events.pipeline.events import event_readings, fetch_events, make_want_long, readings_block
from task18_events.schemas import EventResult

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 250
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


async def run_events_pipeline(*, ticker: str, job_id: str | None = None) -> EventResult:
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
    cik = None
    company_name = ticker
    records, bundle = [], {"activist": [], "redflags": []}
    try:
        cik = (await fetch_sec_ticker_map()).get(ticker)
        if cik is not None:
            company_name = (await fetch_submissions(cik)).get("name", ticker) or ticker
            records, bundle = await fetch_events(cik, since=backtest_start - timedelta(days=180),
                                                 trace_id=job_id, ticker=ticker, budget_usd=_LEG_BUDGET_USD)
    except Exception as e:  # noqa: BLE001
        logger.warning("task18_events_failed", error=str(e)[:200])
        no_data = f"EDGAR events unavailable for {ticker}: {type(e).__name__}."
    if cik is None:
        no_data = f"{ticker} has no US SEC CIK — no EDGAR events."

    readings = event_readings(records, bundle, as_of)
    spec = await author_events(trace_id=job_id, ticker=ticker, readings_block=readings_block(readings),
                               budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(prices, make_want_long(spec, bundle), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    recent = [r for r in records if r.date <= as_of][-12:]
    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Events come from the company's SEC filings (13D, 424B5/S-3, NT 10-K/Q, 8-K Items 4.01/3.01/"
        "5.02), keyed off the FILING date (lookahead-free). 8-K 5.02 departures are LLM-classified "
        "from the filing text (forced/sudden = red flag vs planned retirement). Long-only: activist "
        "13D drives drift, red flags drive avoidance — never shorting.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    if no_data:
        caveats.insert(1, f"⚠️ {no_data} No events fired — flat/buy-and-hold baseline.")
    logger.info("task18_done", ticker=ticker, entry=spec.entry_signal, n_events=len(records),
                ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000))
    return EventResult(job_id=job_id, ticker=ticker, company_name=company_name, cik=cik, as_of_date=as_of,
                       n_events=len(records), events=recent, prices=chart, strategy=spec, backtest=backtest,
                       event_readings=readings, caveats=caveats, cost_usd=round(cost, 6),
                       created_at=datetime.now(timezone.utc))
