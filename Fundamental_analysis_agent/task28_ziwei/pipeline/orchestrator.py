"""Task 28 orchestrator — ticker → natal 紫微 命盤 → 四化飛星 rule → backtest.

⚠️ CONTROL / PLACEBO. Natal chart cast once from the listing date; each bar's
流年/流月 四化 is a pure function of the date, so the long/flat series is deterministic
and lookahead-free. Reuses the generic factor backtest.
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
from task28_ziwei.pipeline import ziwei as Z
from task28_ziwei.pipeline.autoresearch import author_ziwei
from task28_ziwei.schemas import Palace, ZiweiChart, ZiweiResult

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
        logger.warning("task28_listing_lookup_failed", ticker=ticker, error=str(e)[:120])
    return fallback, True


async def run_ziwei_pipeline(*, ticker: str, job_id: str | None = None) -> ZiweiResult:
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
    try:
        natal = await asyncio.to_thread(Z.build_natal, listing)
    except Z.EngineUnavailable as e:
        raise RuntimeError(f"紫微 engine unavailable: {e}")

    readings = Z.ziwei_readings(natal, as_of)
    spec = await author_ziwei(trace_id=job_id, ticker=ticker,
                              readings_block=Z.readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(prices, Z.make_want_long(spec, natal["star_palace"]), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    price_chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    chart = ZiweiChart(
        listing_date=listing, listing_date_is_data_limit=data_limit,
        soul_star=natal["soul"], body_star=natal["body"], five_elements_class=natal["five_elements_class"],
        palaces=[Palace(name=p["name"], branch=p["branch"], is_body=p["is_body"], stars=p["stars"])
                 for p in natal["palaces"]],
        liunian_stem=str(readings.get("liunian_stem", "")), liunian_sihua=str(readings.get("liunian_sihua", "")),
        sihua_landing={k.split(":")[0]: k.split(":", 1)[1] for k in str(readings.get("sihua_landing", "")).split(" ") if ":" in k},
    )
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT. 紫微斗數 has NO economic mechanism. It runs the identical "
        "lookahead-free backtest as the real agents on a deterministic 四化飛星 signal, to calibrate the "
        "suite's false-positive rate. A high Sharpe here means the framework is leaking or you are "
        "seeing selection bias — not that the 命盤 works.",
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        f"Natal 命盤 cast from the listing/first-trade date {listing.isoformat()}"
        + (" — ⚠️ this is the price-feed's earliest date, not the firm's true IPO." if data_limit else "")
        + " via the py_iztro 紫微 engine; the 時辰 assumes the US market open (09:30 → 巳時). 流年/流月 干支 "
        "reuse the 八字 calendar (立春-anchored). The 飛星 rule: 化祿/化權 into 命宮/財帛/官祿 = hold, 化忌 = flat.",
        "The LLM's 命書 is recorded but IGNORED by execution (selection ≠ execution).",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task28_done", ticker=ticker, soul=natal["soul"], entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, sharpe=backtest.metrics.sharpe,
                ms=int((time.perf_counter() - started) * 1000))
    return ZiweiResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of,
                       chart=chart, reasoning_chain=Z.reasoning_chain(natal, as_of), prices=price_chart,
                       strategy=spec, backtest=backtest, ziwei_readings=readings, caveats=caveats,
                       cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
