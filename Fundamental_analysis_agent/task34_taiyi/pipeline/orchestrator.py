"""Task 34 orchestrator — ticker → 太乙神數 主客算 → 勝負 rule → backtest. ⚠️ PLACEBO."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest
from task34_taiyi.pipeline import taiyi as TA
from task34_taiyi.pipeline.autoresearch import author_taiyi
from task34_taiyi.schemas import TaiyiChart, TaiyiResult

logger = get_logger(__name__)
_TXN, _CHART_LB, _BT_LB, _MIN, _BUDGET, _DLY = 10.0, 365, 365 * 3, 250, 0.08, 1962


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
            return d, d.year <= _DLY
    except Exception as e:  # noqa: BLE001
        logger.warning("task34_listing_lookup_failed", ticker=ticker, error=str(e)[:120])
    return fallback, True


async def run_taiyi_pipeline(*, ticker: str, job_id: str | None = None) -> TaiyiResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()
    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(f"price fetch for {ticker} timed out after 30s — retry.")
    except RuntimeError:
        raise TickerNotFound(f"Ticker '{ticker}' returned no price history. Use a US-listed ticker.")
    if len(prices) < _MIN:
        raise RuntimeError(f"only {len(prices)} trading days for {ticker} — too little.")
    as_of = prices[-1].date
    bstart = max(prices[0].date, as_of - timedelta(days=_BT_LB))
    market = None if ticker == "SPY" else await _safe("SPY")
    listing, dl = await asyncio.to_thread(_listing_date, ticker, prices[0].date)

    readings = TA.taiyi_readings(as_of)
    spec = await author_taiyi(trace_id=job_id, ticker=ticker, readings_block=TA.readings_block(readings), budget_usd=_BUDGET)
    backtest = run_factor_backtest(prices, TA.make_want_long(spec), start=bstart, exit_mode="deteriorating",
                                   stop_loss_pct=spec.stop_loss_pct, transaction_cost_bps=_TXN, market_prices=market)
    chart = TaiyiChart(listing_date=listing, listing_date_is_data_limit=dl,
                       accumulated_years=int(readings["accumulated_years"]), taiyi_palace=str(readings["taiyi_palace"]),
                       host_count=int(readings["host_count"]), guest_count=int(readings["guest_count"]),
                       verdict=str(readings["verdict"]))
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT. 太乙神數 has NO economic mechanism; identical lookahead-free "
        "backtest on a worthless signal, to calibrate the suite's false-positive rate.",
        f"Hypothetical backtest, trailing ~3y to {as_of.isoformat()} (start {bstart.isoformat()}). Not advice.",
        "⚠️ 起算 is SIMPLIFIED (real 太乙 walks 太乙積年 through 十六神/九宮 with 格局囚迫); here 主算/客算 are "
        "deterministic counts from 積年 + 流年 whose comparison (主客勝負) drives 吉凶. The LLM reading is IGNORED.",
        f"Transaction cost {_TXN:.0f} bps/side; slippage not modelled. Benchmarks: buy-and-hold + SPY.",
    ]
    logger.info("task34_done", ticker=ticker, entry=spec.entry_signal, ret=backtest.metrics.total_return_pct,
                sharpe=backtest.metrics.sharpe, ms=int((time.perf_counter() - started) * 1000))
    return TaiyiResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of, chart=chart,
                       reasoning_chain=TA.reasoning_chain(listing, as_of),
                       prices=[p for p in prices if p.date >= bstart - timedelta(days=_CHART_LB)],
                       strategy=spec, backtest=backtest, taiyi_readings=readings, caveats=caveats,
                       cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
