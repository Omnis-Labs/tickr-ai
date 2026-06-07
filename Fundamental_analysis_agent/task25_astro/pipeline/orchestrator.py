"""Task 25 orchestrator — ticker → as-of star chart → astrological rule → backtest.

⚠️ CONTROL / PLACEBO. Same lookahead-free pipeline as the real agents, on a
predictively-worthless signal, to calibrate the suite's false-positive rate.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest   # reused generic factor backtest
from task25_astro.pipeline import astro
from task25_astro.pipeline.autoresearch import author_astro
from task25_astro.schemas import AstroResult, PlanetPosition

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 250
_LEG_BUDGET_USD = 0.08


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


async def run_astro_pipeline(*, ticker: str, job_id: str | None = None) -> AstroResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()
    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(f"price fetch for {ticker} timed out after 30s — retry.")
    except RuntimeError:
        raise TickerNotFound(f"Ticker '{ticker}' returned no price history. Use a US-listed ticker.")
    if len(prices) < _MIN_BARS:
        raise RuntimeError(f"only {len(prices)} trading days for {ticker} — too little.")
    as_of = prices[-1].date
    backtest_start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))
    market_prices = None if ticker == "SPY" else await _safe("SPY")

    orb = 6.0
    readings = astro.astro_readings(as_of, orb)
    spec = await author_astro(trace_id=job_id, ticker=ticker,
                              readings_block=astro.readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    orb = spec.aspect_orb_deg
    # precompute the deterministic per-bar astro state over the backtest window
    bar_dates = [p.date for p in prices if p.date >= backtest_start]
    state = astro.build_astro_state(bar_dates, orb)
    backtest = run_factor_backtest(prices, astro.make_want_long(spec, state), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    chart = [PlanetPosition(body=b, ecliptic_lon=lon, sign=sign, retrograde=retro)
             for b, lon, sign, retro in astro.chart_for(as_of)]
    chain = astro.reasoning_chain(as_of, orb)
    price_chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT. Financial astrology has NO known economic mechanism. This runs "
        "the identical lookahead-free backtest as the real agents on a predictively-worthless signal, "
        "to calibrate the suite's false-positive rate. A high Sharpe here means the FRAMEWORK is "
        "leaking (or you are seeing selection bias), NOT that the planets work.",
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Planetary positions are a pure deterministic function of the calendar date (computed offline "
        "via ephem) — so this placebo is, if anything, MORE lookahead-free than the filing-based agents. "
        "The LLM's astrological thesis is recorded but IGNORED by execution (selection ≠ execution).",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task25_done", ticker=ticker, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, sharpe=backtest.metrics.sharpe,
                ms=int((time.perf_counter() - started) * 1000))
    return AstroResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of,
                       chart=chart, aspects=astro.aspects_for(as_of, orb), reasoning_chain=chain,
                       prices=price_chart, strategy=spec, backtest=backtest, astro_readings=readings,
                       caveats=caveats, cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
