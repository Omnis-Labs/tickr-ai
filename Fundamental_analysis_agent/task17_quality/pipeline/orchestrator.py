"""Task 17 orchestrator — ticker → XBRL quality factors → strategy → backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map, fetch_submissions
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.autoresearch import author_quality
from task17_quality.pipeline.backtest import run_factor_backtest
from task17_quality.pipeline.factors import (
    build_bundle, fetch_companyfacts, quality_readings, readings_block, wants_long,
)
from task17_quality.schemas import QualityResult

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


async def run_quality_pipeline(*, ticker: str, job_id: str | None = None) -> QualityResult:
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
    bundle: dict = {}
    try:
        cik = (await fetch_sec_ticker_map()).get(ticker)
        if cik is not None:
            company_name = (await fetch_submissions(cik)).get("name", ticker) or ticker
            bundle = build_bundle(await fetch_companyfacts(cik))
    except Exception as e:  # noqa: BLE001
        logger.warning("task17_xbrl_failed", error=str(e)[:200])
        no_data = f"XBRL fundamentals unavailable for {ticker}: {type(e).__name__}."
    if cik is None:
        no_data = f"{ticker} has no US SEC CIK — no XBRL fundamentals."

    readings = quality_readings(bundle, as_of) if bundle else {"quality_regime": "no_data"}
    spec = await author_quality(trace_id=job_id, ticker=ticker, readings_block=readings_block(readings),
                                budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(
        prices, (lambda d: wants_long(spec, bundle, d)) if bundle else (lambda d: spec.entry_signal == "buy_and_hold"),
        start=backtest_start, exit_mode=spec.exit_signal, holding_days=spec.holding_days,
        stop_loss_pct=spec.stop_loss_pct, transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices,
    )
    chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Signals: Piotroski F-Score, Sloan accruals (NI − operating cash flow / assets), and YoY asset "
        "growth — computed from SEC XBRL annual filings, point-in-time (as-originally-filed, keyed off "
        "the filing date). These are SLOW, annual quality factors; rule-based execution is lookahead-free.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    if no_data:
        caveats.insert(1, f"⚠️ {no_data} No entries fired — flat baseline.")
    logger.info("task17_done", ticker=ticker, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000))
    return QualityResult(job_id=job_id, ticker=ticker, company_name=company_name, cik=cik, as_of_date=as_of,
                         prices=chart, strategy=spec, backtest=backtest, quality_readings=readings,
                         caveats=caveats, cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
