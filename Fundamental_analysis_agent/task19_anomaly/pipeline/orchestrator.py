"""Task 19 orchestrator — ticker → price-anomaly readings → rule → backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest
from task19_anomaly.pipeline.autoresearch import author_anomaly
from task19_anomaly.pipeline.signals import anomaly_readings, make_want_long, readings_block
from task19_anomaly.schemas import AnomalyResult

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 300
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


async def run_anomaly_pipeline(*, ticker: str, job_id: str | None = None) -> AnomalyResult:
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

    readings = anomaly_readings(prices)
    spec = await author_anomaly(trace_id=job_id, ticker=ticker, readings_block=readings_block(readings),
                                budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(prices, make_want_long(spec, prices), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Anomalies (52-week-high momentum, MAX/lottery avoidance, tax-loss/January reversal) use only "
        "trailing price windows + the calendar, so execution is lookahead-free. These are documented "
        "cross-sectional effects applied to a single name — illustrative, and the strategy *selection* "
        "may reflect the model's priors.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task19_done", ticker=ticker, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000))
    return AnomalyResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of, prices=chart,
                         strategy=spec, backtest=backtest, anomaly_readings=readings, caveats=caveats,
                         cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
