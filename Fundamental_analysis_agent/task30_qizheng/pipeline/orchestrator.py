"""Task 30 orchestrator — ticker → natal 七政四餘 → transit rule → backtest. ⚠️ PLACEBO."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import ephem

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest
from task25_astro.pipeline import astro as A
from task30_qizheng.pipeline import qizheng as Q
from task30_qizheng.pipeline.autoresearch import author_qizheng
from task30_qizheng.schemas import QizhengChart, QizhengResult, Star

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 250
_LEG_BUDGET_USD = 0.08
_DATA_LIMIT_YEAR = 1962


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


def _listing_date(ticker: str, fallback: date) -> tuple[date, bool]:
    try:
        import yfinance as yf
        md = yf.Ticker(ticker).history_metadata
        ftd = md.get("firstTradeDate") if isinstance(md, dict) else None
        if ftd is not None:
            d = datetime.fromtimestamp(int(ftd), tz=timezone.utc).date() if not isinstance(ftd, datetime) else ftd.date()
            return d, d.year <= _DATA_LIMIT_YEAR
    except Exception as e:  # noqa: BLE001
        logger.warning("task30_listing_lookup_failed", ticker=ticker, error=str(e)[:120])
    return fallback, True


async def run_qizheng_pipeline(*, ticker: str, job_id: str | None = None) -> QizhengResult:
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

    listing, data_limit = await asyncio.to_thread(_listing_date, ticker, prices[0].date)
    natal_chart = Q.chart_for(listing)
    natal_sun_sign = int(Q._lon(ephem.Sun, listing) // 30) % 12
    readings = Q.qizheng_readings(natal_sun_sign, as_of)
    spec = await author_qizheng(trace_id=job_id, ticker=ticker,
                                readings_block=Q.readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    bar_dates = [p.date for p in prices if p.date >= backtest_start]
    state = Q.build_state(bar_dates, natal_sun_sign)
    backtest = run_factor_backtest(prices, Q.make_want_long(spec, state), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    chart = QizhengChart(
        listing_date=listing, listing_date_is_data_limit=data_limit, ming_zhu_sign=A._SIGNS[natal_sun_sign],
        seven=[Star(name=n, ecliptic_lon=lo, sign=s) for n, lo, s in natal_chart[:7]],
        siyu=[Star(name=n, ecliptic_lon=lo, sign=s) for n, lo, s in natal_chart[7:]],
        jupiter_sign=str(readings.get("jupiter_sign", "")), mars_sign=str(readings.get("mars_sign", "")),
        rahu_sign=str(readings.get("rahu_sign", "")))
    price_chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT. 七政四餘 has NO economic mechanism. It runs the identical "
        "lookahead-free backtest as the real agents on a deterministic astral signal, to calibrate the "
        "suite's false-positive rate. A high Sharpe here means the framework is leaking or selection bias.",
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        f"Natal 星盤 cast from the listing date {listing.isoformat()}"
        + (" — ⚠️ price-feed earliest date, not the true IPO." if data_limit else "")
        + ". 七政 from ephem; 四餘 from standard mean elements (羅睺=月升交點, 月孛=月遠地點), except "
        "紫炁 which is a defined FICTITIOUS slow point (no astronomical basis). 命主 = natal Sun. The "
        "signal rides 歲星/火星/羅睺 transits vs the natal Sun, a pure function of the date.",
        "The LLM's 星命 reading is recorded but IGNORED by execution (selection ≠ execution).",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task30_done", ticker=ticker, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, sharpe=backtest.metrics.sharpe,
                ms=int((time.perf_counter() - started) * 1000))
    return QizhengResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of, chart=chart,
                         reasoning_chain=Q.reasoning_chain(natal_sun_sign, as_of, natal_chart), prices=price_chart,
                         strategy=spec, backtest=backtest, qizheng_readings=readings, caveats=caveats,
                         cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
