"""Task 29 orchestrator — ticker → natal 四柱推命 → 十二運星/天中殺 rule → backtest.

⚠️ CONTROL / PLACEBO. Natal chart cast once from the listing date; each bar's 流年
branch (→ 十二運星 / 天中殺 test) is a pure function of the date, so the long/flat
series is deterministic and lookahead-free. Reuses the generic factor backtest.
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
from task29_suimei.pipeline import suimei as S
from task29_suimei.pipeline.autoresearch import author_suimei
from task29_suimei.pipeline.signals import build_chart_model, reasoning_chain, readings_block, suimei_readings
from task29_suimei.schemas import SuimeiResult

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
        logger.warning("task29_listing_lookup_failed", ticker=ticker, error=str(e)[:120])
    return fallback, True


async def run_suimei_pipeline(*, ticker: str, job_id: str | None = None) -> SuimeiResult:
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
    chart = build_chart_model(listing, data_limit, as_of)
    natal = S.build_chart(listing)
    readings = suimei_readings(chart)
    spec = await author_suimei(trace_id=job_id, ticker=ticker,
                               readings_block=readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(
        prices, S.make_want_long(spec, natal["day_stem_idx"], natal["void"]), start=backtest_start,
        exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
        transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    price_chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT. 四柱推命 has NO economic mechanism. It runs the identical "
        "lookahead-free backtest as the real agents on a deterministic divination signal, to calibrate "
        "the suite's false-positive rate. A high Sharpe here means the framework is leaking or you are "
        "seeing selection bias — not that the 命式 works.",
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        f"Natal 命式 cast from the listing date {listing.isoformat()}"
        + (" — ⚠️ price-feed earliest date, not the true IPO." if data_limit else "")
        + ". Japanese reading: the signal rides 十二運星 (life-stage cycle) and 天中殺 (空亡) — the "
        "axes the 京都泰山流 / 細木数子 systems centre on, mere footnotes in Chinese 八字. 流年/流月 干支 "
        "reuse the 立春-anchored 八字 calendar; 藏干 shown standard (Taizan-ryū 節入深淺 not applied).",
        "The LLM's 鑑定書 is recorded but IGNORED by execution (selection ≠ execution).",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task29_done", ticker=ticker, dm=chart.day_master, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, sharpe=backtest.metrics.sharpe,
                ms=int((time.perf_counter() - started) * 1000))
    return SuimeiResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of,
                        chart=chart, reasoning_chain=reasoning_chain(chart, as_of), prices=price_chart,
                        strategy=spec, backtest=backtest, suimei_readings=readings, caveats=caveats,
                        cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
