"""Task 27 orchestrator — ticker → natal 八字 from listing date → 喜用神 rule → backtest.

⚠️ CONTROL / PLACEBO. The natal chart is cast once from the firm's first-trade date;
each bar's 流年/流月 五行 is a pure function of the date, so the long/flat series is
deterministic and lookahead-free. Reuses the generic factor backtest.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest   # reused generic factor backtest
from task27_bazi.pipeline import bazi as B
from task27_bazi.pipeline.autoresearch import author_bazi
from task27_bazi.pipeline.signals import bazi_readings, build_chart, reasoning_chain, readings_block
from task27_bazi.schemas import BaziResult

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 250
_LEG_BUDGET_USD = 0.08
_DATA_LIMIT_YEAR = 1962          # Yahoo's earliest daily data — older "first trade" dates are data limits


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
    """First-trade date from yfinance metadata; fallback to the earliest price bar."""
    try:
        import yfinance as yf
        md = yf.Ticker(ticker).history_metadata
        ftd = md.get("firstTradeDate") if isinstance(md, dict) else None
        if ftd is not None:
            d = datetime.fromtimestamp(int(ftd), tz=timezone.utc).date() if not isinstance(ftd, datetime) else ftd.date()
            return d, d.year <= _DATA_LIMIT_YEAR
    except Exception as e:  # noqa: BLE001
        logger.warning("task27_listing_lookup_failed", ticker=ticker, error=str(e)[:120])
    return fallback, True


async def run_bazi_pipeline(*, ticker: str, job_id: str | None = None) -> BaziResult:
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
    chart, fav = build_chart(listing, data_limit=data_limit)
    readings = bazi_readings(chart, as_of)
    spec = await author_bazi(trace_id=job_id, ticker=ticker,
                             readings_block=readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(prices, B.make_want_long(spec, set(chart.favourable)), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    price_chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT. 八字 has NO economic mechanism. It runs the identical "
        "lookahead-free backtest as the real agents on a deterministic divination signal, to calibrate "
        "the suite's false-positive rate. A high Sharpe here means the framework is leaking or you are "
        "seeing selection bias — not that the natal chart works.",
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        f"Natal chart cast from the listing/first-trade date {listing.isoformat()}"
        + (" — ⚠️ this is the price-feed's earliest date, not the firm's true IPO (it pre-dates the data), "
           "so the pillars are a data-limit proxy." if data_limit else " (firm's first-trade date).")
        + " The 時柱 assumes the US market open (09:30 → 巳時) since IPO clock-times aren't published. "
        "Solar-term month boundaries use the standard ±1-day approximations; the day & year pillars are "
        "pinned to verifiable anchors (2000-01-07 = 甲子日, 1984 = 甲子年).",
        "流年/流月 五行 are pure functions of the date; the LLM's 命書 is recorded but IGNORED by execution.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task27_done", ticker=ticker, dm=chart.day_master, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, sharpe=backtest.metrics.sharpe,
                ms=int((time.perf_counter() - started) * 1000))
    return BaziResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of,
                      chart=chart, reasoning_chain=reasoning_chain(chart, as_of), prices=price_chart,
                      strategy=spec, backtest=backtest, bazi_readings=readings, caveats=caveats,
                      cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
