"""Task 21 orchestrator — watchlist → cross-sectional factor rank → top-N portfolio backtest.

Prices for all names + SPY are fetched once; a common trading-day axis (the
intersection of the names' dates over a trailing ~3y) aligns every name. The LLM
picks ONE ranking factor from as-of universe stats; at each rebalance the universe
is ranked by that factor (trailing data only) and the top-N is held, equal- or
inverse-vol weighted. Reuses Task 10's deterministic, lookahead-free portfolio
backtest verbatim — only the membership (in_market_by_name) comes from the ranking.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task3_strategy.pipeline.prices import fetch_prices
from task10_portfolio.pipeline.backtest import run_portfolio_backtest
from task21_ranker.pipeline.autoresearch import author_rank
from task21_ranker.pipeline.rank import asof_factor_readings, build_membership, readings_block
from task21_ranker.schemas import RankHolding, RankResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 260                 # need ≥ ~1y + buffer so the 12-1 factor is defined early
_MIN_NAMES = 3                  # cross-sectional ranking is meaningless with < 3 names
_MAX_NAMES = 20
_LEG_BUDGET_USD = 0.10


class NotEnoughNames(ValueError):
    """Raised when fewer than three tickers have usable price history."""


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch_safe(ticker: str) -> list | None:
    try:
        return await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)
    except Exception as e:  # noqa: BLE001
        logger.warning("task21_fetch_failed", ticker=ticker, error=str(e)[:120])
        return None


def _align(prices: list, common_dates: list[date]) -> list[float]:
    """Forward-fill a name's closes onto the common axis (carry last known close)."""
    by_date = {p.date: p.close for p in prices}
    out, last = [], None
    for d in common_dates:
        if d in by_date:
            last = by_date[d]
        out.append(last if last is not None else 0.0)
    return out


async def run_rank_pipeline(*, tickers: list[str], job_id: str | None = None) -> RankResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    seen: list[str] = []
    for t in tickers:
        u = (t or "").strip().upper()
        if u and u not in seen:
            seen.append(u)
    tickers = seen[:_MAX_NAMES]
    if len(tickers) < _MIN_NAMES:
        raise NotEnoughNames(f"need at least {_MIN_NAMES} distinct tickers (got {len(tickers)}).")

    # ----- fetch all prices + SPY concurrently -----
    fetched = await asyncio.gather(*[_fetch_safe(t) for t in tickers], _fetch_safe("SPY"))
    spy_prices = fetched[-1]
    price_by_ticker = {t: p for t, p in zip(tickers, fetched[:-1]) if p and len(p) >= _MIN_BARS}
    dropped = [t for t in tickers if t not in price_by_ticker]
    if len(price_by_ticker) < _MIN_NAMES:
        raise NotEnoughNames(
            f"only {len(price_by_ticker)} of {len(tickers)} tickers had usable price history "
            f"(need ≥ {_MIN_NAMES}). Dropped: {', '.join(dropped) or 'none'}."
        )

    # ----- common trading-day axis (intersection over a trailing ~3y) -----
    date_sets = [set(p.date for p in pr) for pr in price_by_ticker.values()]
    inter = set.intersection(*date_sets)
    as_of = max(inter)
    start_bound = as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS)
    common_dates = sorted(d for d in inter if d >= start_bound)
    if len(common_dates) < _MIN_BARS:
        raise RuntimeError(
            f"only {len(common_dates)} shared trading days across the basket — too little to "
            f"backtest a factor portfolio (need ≥ {_MIN_BARS})."
        )
    common_start = common_dates[0]
    closes_by_name = {t: _align(pr, common_dates) for t, pr in price_by_ticker.items()}

    # ----- as-of universe readings + LLM ranking policy -----
    readings = asof_factor_readings(closes_by_name)
    spec = await author_rank(
        trace_id=job_id, n_names=len(closes_by_name),
        readings_block=readings_block(readings), budget_usd=_LEG_BUDGET_USD,
    )
    # top_n can't exceed the available universe
    spec.top_n = max(1, min(spec.top_n, len(closes_by_name) - 1))

    # ----- per-bar membership from the chosen factor -----
    in_market, score, latest_val, latest_rank = build_membership(
        dates=common_dates, closes_by_name=closes_by_name,
        factor=spec.factor, top_n=spec.top_n, lookback_days=spec.lookback_days,
    )

    spy_closes = _align(spy_prices, common_dates) if spy_prices else None

    equity_curve, metrics, avg_weight, _long_as_of = run_portfolio_backtest(
        dates=common_dates,
        closes_by_name=closes_by_name,
        in_market_by_name=in_market,
        score_by_name=score,
        spy_closes=spy_closes,
        method=spec.weight_method, max_weight=spec.max_weight, gross_cap=1.0,
        target_vol_pct=0.0, rebalance=spec.rebalance,
        vol_lookback_days=min(63, spec.lookback_days), transaction_cost_bps=_TXN_COST_BPS,
    )

    # ----- holdings summary (current rank + portfolio role) -----
    holdings: list[RankHolding] = []
    for t, closes in closes_by_name.items():
        standalone = round((closes[-1] / closes[0] - 1.0) * 100.0, 2) if closes and closes[0] > 0 else None
        holdings.append(RankHolding(
            ticker=t, available=True,
            factor_value=round(latest_val[t], 4) if latest_val.get(t) is not None else None,
            rank=latest_rank.get(t),
            selected_now=in_market[t][-1],
            avg_weight_pct=avg_weight.get(t, 0.0),
            standalone_return_pct=standalone,
        ))
    for t in dropped:
        holdings.append(RankHolding(ticker=t, available=False, note="no usable price history"))
    holdings.sort(key=lambda h: (h.rank is None, h.rank or 1e9))

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical long-only factor portfolio over a common window "
        f"{common_start.isoformat()} → {as_of.isoformat()} (the trading days shared by all names). "
        f"Not investment advice.",
        "Past performance does not predict future returns.",
        f"At each {spec.rebalance} rebalance the universe is ranked by the chosen factor using "
        f"ONLY data prior to that bar, and the top {spec.top_n} are held — so selection is "
        f"lookahead-free. The LLM chose only the FACTOR + cadence, not the names.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps on rebalance turnover; slippage and "
        f"market impact are not. Short-term-reversal in particular turns over fast and is more "
        f"cost-sensitive than the metrics suggest.",
        "Benchmarks: an equal-weight, always-invested buy-and-hold of ALL the names (isolates the "
        "value of the cross-sectional selection) and the S&P 500 (SPY). Survivorship: the watchlist "
        "is supplied by you, so names that were later delisted won't appear — real factor returns "
        "would differ.",
    ]
    if dropped:
        caveats.insert(1, f"⚠️ Dropped (no usable price history): {', '.join(dropped)}.")

    logger.info(
        "task21_done", n=len(closes_by_name), factor=spec.factor, top_n=spec.top_n,
        ret=metrics.total_return_pct, excess=metrics.excess_return_pct,
        alpha_mkt=metrics.excess_vs_market_pct, ms=int((time.perf_counter() - started) * 1000),
    )

    return RankResult(
        job_id=job_id,
        tickers=list(closes_by_name.keys()),
        as_of_date=as_of,
        common_window_start=common_start,
        spec=spec,
        holdings=holdings,
        metrics=metrics,
        equity_curve=equity_curve,
        universe_readings=readings,
        caveats=caveats,
        cost_usd=round(cost, 6),
        created_at=datetime.now(timezone.utc),
    )
