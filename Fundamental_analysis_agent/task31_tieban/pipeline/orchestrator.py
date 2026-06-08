"""Task 31 orchestrator — ticker → 鐵板神數 起數 → 條文吉凶 rule → backtest. ⚠️ PLACEBO."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest
from task27_bazi.pipeline import bazi as B
from task31_tieban.pipeline import tieban as T
from task31_tieban.pipeline.autoresearch import author_tieban
from task31_tieban.schemas import TiebanChart, TiebanPillar, TiebanResult

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
        logger.warning("task31_listing_lookup_failed", ticker=ticker, error=str(e)[:120])
    return fallback, True


async def run_tieban_pipeline(*, ticker: str, job_id: str | None = None) -> TiebanResult:
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
    ming = T.ming_number(listing)
    readings = T.tieban_readings(listing, ming, as_of)
    spec = await author_tieban(trace_id=job_id, ticker=ticker,
                               readings_block=T.readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(prices, T.make_want_long(spec, ming), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    p = B.four_pillars(listing)
    roles = {"year": "年", "month": "月", "day": "日", "hour": "時"}
    chart = TiebanChart(
        listing_date=listing, listing_date_is_data_limit=data_limit,
        pillars=[TiebanPillar(role=roles[k], gz=p[k]["gz"],
                              taixuan=T._gz_number(p[k]["stem_idx"], p[k]["branch_idx"]))
                 for k in ("year", "month", "day", "hour")],
        ming_number=ming, liunian_verse_no=T.liunian_number(ming, as_of),
        liunian_verdict=str(readings.get("liunian_verdict", "")), liunian_gua=str(readings.get("liunian_gua", "")))
    price_chart = [p2 for p2 in prices if p2.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT — and a DOUBLE one: 鐵板神數's real 條文 萬言書 is "
        "proprietary/legendary (no public algorithm exists), so this uses a deterministic 太玄數 "
        "起例 as an honest stand-in, which itself has NO economic mechanism. It runs the identical "
        "lookahead-free backtest to calibrate the suite's false-positive rate.",
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        f"命數 (太極數) = Σ 太玄數 over the natal 四柱 ({listing.isoformat()}"
        + (" — price-feed earliest date, not the true IPO" if data_limit else "")
        + "); the 流年條文編號 = 命數 + 流年干支太玄數, verdict = 編號 mod 3 (吉/平/凶). 流年干支 reuse "
        "the 立春-anchored 八字 calendar. The LLM's 條文 verse is recorded but IGNORED by execution.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task31_done", ticker=ticker, ming=ming, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, sharpe=backtest.metrics.sharpe,
                ms=int((time.perf_counter() - started) * 1000))
    return TiebanResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of, chart=chart,
                        reasoning_chain=T.reasoning_chain(listing, ming, as_of), prices=price_chart,
                        strategy=spec, backtest=backtest, tieban_readings=readings, caveats=caveats,
                        cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
