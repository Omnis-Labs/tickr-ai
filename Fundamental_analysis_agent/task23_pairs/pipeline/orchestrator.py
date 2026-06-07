"""Task 23 orchestrator — two tickers → spread z-score → mean-reversion rule → neutral backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task23_pairs.pipeline.autoresearch import author_pairs
from task23_pairs.pipeline.pairs import compute_z_series, pair_readings, readings_block, run_pairs_backtest
from task23_pairs.schemas import PairResult

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
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


def _align(prices: list, common: list[date]) -> list[float]:
    by = {p.date: p.close for p in prices}
    out, last = [], None
    for d in common:
        if d in by:
            last = by[d]
        out.append(last if last is not None else 0.0)
    return out


async def run_pairs_pipeline(*, ticker_a: str, ticker_b: str, job_id: str | None = None) -> PairResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    a, b = ticker_a.strip().upper(), ticker_b.strip().upper()
    if a == b:
        raise TickerNotFound("provide two DIFFERENT tickers for a pair (e.g. KO, PEP).")
    pa, pb, spy = await asyncio.gather(_safe(a), _safe(b), _safe("SPY"))
    for t, p in ((a, pa), (b, pb)):
        if not p:
            raise TickerNotFound(f"Ticker '{t}' returned no price history. Use US-listed tickers.")
        if len(p) < _MIN_BARS:
            raise RuntimeError(f"only {len(p)} trading days for {t} — too little for a pairs backtest.")

    inter = {p.date for p in pa} & {p.date for p in pb}
    as_of = max(inter)
    start_bound = as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS)
    common = sorted(d for d in inter if d >= start_bound)
    if len(common) < _MIN_BARS:
        raise RuntimeError(f"only {len(common)} overlapping trading days for {a}/{b} — too little.")
    ca, cb = _align(pa, common), _align(pb, common)
    spy_c = _align(spy, common) if spy else None

    zs, betas = compute_z_series(ca, cb, 63)
    readings = pair_readings(ca, cb, zs, betas, 63)
    spec = await author_pairs(trace_id=job_id, pair=f"{a} / {b}",
                              readings_block=readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    # readings used a default 63-window; recompute the live z/β at the chosen window for display
    if spec.formation_window != 63:
        zs2, betas2 = compute_z_series(ca, cb, spec.formation_window)
        readings = pair_readings(ca, cb, zs2, betas2, spec.formation_window)

    backtest = run_pairs_backtest(common, ca, cb, spec, transaction_cost_bps=_TXN_COST_BPS, spy_closes=spy_c)
    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical MARKET-NEUTRAL (long-short) backtest over {common[0].isoformat()} → "
        f"{as_of.isoformat()} (the days {a} and {b} both traded). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Dollar-neutral: +1 = long {a} / short {b} (0.5 gross each side), −1 = the reverse. "
        f"β (hedge ratio) and the z-score's mean/std are estimated on a trailing {spec.formation_window}-bar "
        f"window strictly before each bar; the z at close i executes at open i+1 — lookahead-free.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side on turnover; borrow cost to "
        f"hold the short leg, hard-to-borrow fees, and slippage are NOT modelled — real stat-arb "
        f"economics are worse. Shorting also carries unlimited downside if the relationship breaks.",
        "Benchmarks shown for context only: a long-only 50/50 buy-and-hold of the two names, and the "
        "S&P 500 (SPY). A market-neutral return is NOT directly comparable to a long-only one — judge "
        "it on Sharpe and drawdown, not raw return vs the basket.",
        f"Pair quality from the readings: correlation {readings.get('return_correlation')}, "
        f"half-life {readings.get('half_life_days')}d. Weak correlation or a non-mean-reverting spread "
        f"means there is no real pair — treat a flashy backtest with suspicion.",
    ]
    logger.info("task23_done", pair=f"{a}/{b}", z_entry=spec.z_entry, ret=backtest.metrics.total_return_pct,
                sharpe=backtest.metrics.sharpe, n=backtest.metrics.n_trades,
                ms=int((time.perf_counter() - started) * 1000))
    return PairResult(job_id=job_id, ticker_a=a, ticker_b=b, as_of_date=as_of, common_window_start=common[0],
                      spec=spec, metrics=backtest.metrics, equity_curve=backtest.equity_curve,
                      trades=backtest.trades, pair_readings=readings, caveats=caveats,
                      cost_usd=round(cost, 6), created_at=datetime.now(timezone.utc))
