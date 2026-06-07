"""Task 26 orchestrator — ticker → 時間起卦 → 體用生剋 rule → backtest.

⚠️ CONTROL / PLACEBO. Same lookahead-free pipeline as the real agents, on a
deterministic divination signal, to calibrate the suite's false-positive rate.
The `seed` is threaded through so the null-distribution harness can draw many
independent placebo backtests from the same code path.
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
from task26_meihua.pipeline.autoresearch import author_meihua
from task26_meihua.pipeline.iching import divine
from task26_meihua.pipeline.signals import (
    build_divinations, make_want_long, meihua_readings, reasoning_chain, readings_block, to_chart,
)
from task26_meihua.schemas import MeihuaResult

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


async def run_meihua_pipeline(*, ticker: str, seed: int = 0, author: bool = True,
                              job_id: str | None = None) -> MeihuaResult:
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

    as_of_div = divine(as_of, seed)
    readings = meihua_readings(as_of_div)
    if author:
        spec = await author_meihua(trace_id=job_id, ticker=ticker, readings_block=readings_block(readings),
                                   seed=seed, budget_usd=_LEG_BUDGET_USD)
    else:
        from task26_meihua.schemas import MeihuaSpec   # null-distribution path: skip the LLM
        spec = MeihuaSpec(entry_signal="ti_yong_auspicious", seed=seed,
                          thesis="(null-distribution draw — LLM skipped)", rationale="placebo control")

    bar_dates = [p.date for p in prices if p.date >= backtest_start]
    divs = build_divinations(bar_dates, spec.seed)
    backtest = run_factor_backtest(prices, make_want_long(spec, divs), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    price_chart = [p for p in prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    cost = await cost_for_trace(job_id)
    caveats = [
        "⚠️ CONTROL / PLACEBO AGENT. 梅花易數 has NO economic mechanism. It runs the identical "
        "lookahead-free backtest as the real agents on a deterministic divination signal, to calibrate "
        "the suite's false-positive rate (it is also the engine behind the null-distribution / Reality "
        "Check). A high Sharpe here means the FRAMEWORK is leaking or you are seeing selection bias — "
        "not that the hexagram works.",
        f"Hypothetical backtest over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "起卦 is a pure deterministic function of the date(+seed): one date → one hexagram, reproducible "
        "and zero-lookahead. The LLM's 卦辭 is recorded but IGNORED by execution (selection ≠ execution).",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        "Benchmarks: buy-and-hold of the stock and the S&P 500 (SPY).",
    ]
    logger.info("task26_done", ticker=ticker, seed=spec.seed, entry=spec.entry_signal,
                ret=backtest.metrics.total_return_pct, sharpe=backtest.metrics.sharpe,
                ms=int((time.perf_counter() - started) * 1000))
    return MeihuaResult(job_id=job_id, ticker=ticker, company_name=ticker, as_of_date=as_of,
                        hexagram=to_chart(as_of_div), reasoning_chain=reasoning_chain(as_of_div, as_of),
                        prices=price_chart, strategy=spec, backtest=backtest, meihua_readings=readings,
                        caveats=caveats, cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
