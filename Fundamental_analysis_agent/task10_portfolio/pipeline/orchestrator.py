"""Task 10 orchestrator — watchlist → per-name T4 signals → LLM sizing policy → portfolio backtest.

Prices for all names + SPY are fetched once; a common trading-day axis (the
intersection of the names' dates over a trailing ~3y) gives every name an aligned
series so the portfolio backtest is well-defined. Per-name signals are authored
concurrently. The LLM picks the sizing policy from as-of universe stats; the
deterministic portfolio backtest executes it, lookahead-free.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task3_strategy.pipeline.prices import fetch_prices
from task10_portfolio.pipeline.autoresearch import author_portfolio
from task10_portfolio.pipeline.backtest import run_portfolio_backtest
from task10_portfolio.pipeline.signals import NameSignal, build_name_signal
from task10_portfolio.pipeline.sizing import annualised_vol, covariance
from task10_portfolio.schemas import Holding, PortfolioResult

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 200
_MIN_NAMES = 2
_MAX_NAMES = 15
_LEG_BUDGET_USD = 0.10
_CORR_WINDOW = 63


class NotEnoughNames(ValueError):
    """Raised when fewer than two tickers have usable price history."""


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch_safe(ticker: str) -> list | None:
    try:
        return await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)
    except Exception as e:  # noqa: BLE001
        logger.warning("task10_fetch_failed", ticker=ticker, error=str(e)[:120])
        return None


def _daily(closes: list[float]) -> list[float]:
    return [0.0] + [closes[i] / closes[i - 1] - 1.0 if closes[i - 1] > 0 else 0.0
                    for i in range(1, len(closes))]


def _universe_readings(signals: list[NameSignal], common_dates: list[date]) -> dict[str, float | str]:
    avail = [s for s in signals if s.available]
    n = len(avail)
    long_now = sum(1 for s in avail if s.in_market and s.in_market[-1])
    rets = {s.ticker: _daily(s.closes)[-_CORR_WINDOW:] for s in avail}
    vols = {t: annualised_vol(r) for t, r in rets.items()}
    vlist = [v for v in vols.values() if v > 0]
    # mean pairwise correlation
    corrs = []
    ts = list(rets.keys())
    for i in range(len(ts)):
        for j in range(i + 1, len(ts)):
            vi, vj = vols[ts[i]], vols[ts[j]]
            if vi > 1e-9 and vj > 1e-9:
                corrs.append(covariance(rets[ts[i]], rets[ts[j]]) / (vi * vj))
    return {
        "n_names": float(n),
        "n_long_now": float(long_now),
        "breadth_pct_long_now": round(long_now / n * 100.0, 1) if n else 0.0,
        "mean_ann_vol_pct": round(sum(vlist) / len(vlist) * 100.0, 1) if vlist else 0.0,
        "min_ann_vol_pct": round(min(vlist) * 100.0, 1) if vlist else 0.0,
        "max_ann_vol_pct": round(max(vlist) * 100.0, 1) if vlist else 0.0,
        "mean_pairwise_correlation": round(sum(corrs) / len(corrs), 2) if corrs else 0.0,
    }


def _readings_block(r: dict[str, float | str]) -> str:
    order = ["n_names", "n_long_now", "breadth_pct_long_now", "mean_ann_vol_pct",
             "min_ann_vol_pct", "max_ann_vol_pct", "mean_pairwise_correlation"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


async def run_portfolio_pipeline(*, tickers: list[str], job_id: str | None = None) -> PortfolioResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    # normalise + dedupe + cap
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
            f"backtest a portfolio (need ≥ {_MIN_BARS})."
        )
    common_start = common_dates[0]

    # ----- per-name T4 signals (concurrent) -----
    signals: list[NameSignal] = await asyncio.gather(*[
        build_name_signal(
            job_id=job_id, ticker=t, prices=pr, common_start=common_start, as_of=as_of,
            common_dates=common_dates, market_prices=spy_prices, budget_usd=_LEG_BUDGET_USD,
        ) for t, pr in price_by_ticker.items()
    ])
    avail = [s for s in signals if s.available]
    if len(avail) < _MIN_NAMES:
        raise RuntimeError(f"only {len(avail)} names produced a usable signal (need ≥ {_MIN_NAMES}).")

    # ----- universe readings + LLM sizing policy -----
    readings = _universe_readings(signals, common_dates)
    spec = await author_portfolio(
        trace_id=job_id, n_names=len(avail),
        readings_block=_readings_block(readings), budget_usd=_LEG_BUDGET_USD,
    )

    # ----- portfolio backtest over the available names -----
    spy_close_map = {p.date: p.close for p in (spy_prices or [])}
    spy_closes = None
    if spy_prices:
        spy_closes, last = [], None
        for d in common_dates:
            if d in spy_close_map:
                last = spy_close_map[d]
            spy_closes.append(last if last is not None else 0.0)

    equity_curve, metrics, avg_weight, long_as_of = run_portfolio_backtest(
        dates=common_dates,
        closes_by_name={s.ticker: s.closes for s in avail},
        in_market_by_name={s.ticker: s.in_market for s in avail},
        score_by_name={s.ticker: s.score for s in avail},
        spy_closes=spy_closes,
        method=spec.method, max_weight=spec.max_weight, gross_cap=spec.gross_cap,
        target_vol_pct=spec.target_vol_pct, rebalance=spec.rebalance,
        vol_lookback_days=spec.vol_lookback_days, transaction_cost_bps=_TXN_COST_BPS,
    )

    # ----- holdings summary (incl. dropped/unavailable, honestly) -----
    holdings: list[Holding] = []
    for s in signals:
        trail_vol = annualised_vol(_daily(s.closes)[-_CORR_WINDOW:]) * 100.0 if s.available else None
        holdings.append(Holding(
            ticker=s.ticker, available=s.available, stance=s.stance,
            entry_signal=s.entry_signal, long_as_of=long_as_of.get(s.ticker, False),
            ann_vol_pct=round(trail_vol, 1) if trail_vol else None,
            standalone_return_pct=s.standalone_return_pct,
            avg_weight_pct=avg_weight.get(s.ticker, 0.0), note=s.note,
        ))
    for t in dropped:
        holdings.append(Holding(ticker=t, available=False, note="no usable price history"))

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical portfolio backtest over a common window {common_start.isoformat()} → "
        f"{as_of.isoformat()} (the trading days shared by all names). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps on rebalance turnover; slippage and "
        f"market impact are not. The book sits in cash during an initial warm-up before the first "
        f"rebalance (so it can estimate trailing vol), which the benchmark does not — early "
        f"underperformance vs the basket can reflect that, not bad allocation.",
        "Per-name long/flat signals come from the Task 4 technical agent (one strategy authored "
        "per name from as-of readings). The LLM here chose only the SIZING POLICY (method + caps + "
        "vol target + rebalance) from as-of universe stats — NOT per-name weights, which are "
        "computed deterministically. Rule-based execution prevents lookahead.",
        "Benchmarks: an equal-weight, always-invested buy-and-hold of the SAME names (isolates the "
        "value of signal-gating + sizing + risk control) and the S&P 500 (SPY).",
    ]
    if dropped:
        caveats.insert(1, f"⚠️ Dropped (no usable price history): {', '.join(dropped)}.")

    logger.info(
        "task10_done", n=len(avail), method=spec.method, ret=metrics.total_return_pct,
        excess=metrics.excess_return_pct, alpha_mkt=metrics.excess_vs_market_pct,
        ms=int((time.perf_counter() - started) * 1000),
    )

    return PortfolioResult(
        job_id=job_id,
        tickers=[s.ticker for s in avail],
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
