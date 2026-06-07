"""Portfolio backtest. Pure, deterministic, lookahead-free.

Inputs are aligned to a common date axis. At each rebalance the target weights are
computed from information strictly prior to that bar (trailing vol/cov over the
lookback; each name's long/flat decided on the prior close by the underlying T4
agent), then the book is rebalanced at that bar and weights DRIFT until the next
rebalance. A one-way transaction cost is charged on rebalance turnover.

Reported against two honest benchmarks: an equal-weight, always-invested
buy-and-hold of the SAME names (isolates the value of gating + sizing + risk
control) and the S&P 500 (SPY).
"""

from __future__ import annotations

import math
from datetime import date

from task10_portfolio.pipeline.sizing import annualised_vol, covariance, target_weights
from task10_portfolio.schemas import PortfolioMetrics, PortfolioPoint

_TRADING_DAYS = 252
_STEP = {"weekly": 5, "monthly": 21, "quarterly": 63}


def _daily_returns(closes: list[float]) -> list[float]:
    out = [0.0]
    for i in range(1, len(closes)):
        out.append(closes[i] / closes[i - 1] - 1.0 if closes[i - 1] > 0 else 0.0)
    return out


def run_portfolio_backtest(
    *,
    dates: list[date],
    closes_by_name: dict[str, list[float]],
    in_market_by_name: dict[str, list[bool]],
    score_by_name: dict[str, float],
    spy_closes: list[float] | None,
    method: str,
    max_weight: float,
    gross_cap: float,
    target_vol_pct: float,
    rebalance: str,
    vol_lookback_days: int,
    transaction_cost_bps: float = 10.0,
) -> tuple[list[PortfolioPoint], PortfolioMetrics, dict[str, float], dict[str, bool]]:
    names = list(closes_by_name.keys())
    n_days = len(dates)
    if n_days < 2 or not names:
        raise RuntimeError("insufficient data for a portfolio backtest")

    rets = {t: _daily_returns(closes_by_name[t]) for t in names}
    cost = transaction_cost_bps / 10_000.0
    step = _STEP.get(rebalance, 21)
    warmup = min(max(vol_lookback_days, step), n_days // 4)

    # strategy book: per-name dollar value + cash (book starts at 1.0, all cash)
    val = {t: 0.0 for t in names}
    cash = 1.0
    # equal-weight always-invested benchmark (buy & hold from the first bar)
    bench_val = {t: 1.0 / len(names) for t in names}

    equity_curve: list[PortfolioPoint] = []
    weight_sum = {t: 0.0 for t in names}
    n_holdings_sum = 0.0
    gross_sum = 0.0
    invested_days = 0
    turnover_total = 0.0
    n_rebalances = 0
    strat_series: list[float] = []

    for i in range(n_days):
        # ---- grow positions by today's return ----
        if i > 0:
            for t in names:
                val[t] *= (1.0 + rets[t][i])
                bench_val[t] *= (1.0 + rets[t][i])
        equity = cash + sum(val.values())

        # ---- rebalance? decided on info up to bar i-1, applied at bar i ----
        if i >= warmup and (i - warmup) % step == 0 and equity > 0:
            longs = [t for t in names if in_market_by_name[t][i]]
            if longs:
                vols = [annualised_vol(rets[t][max(0, i - vol_lookback_days):i]) for t in longs]
                cov = [[covariance(rets[a][max(0, i - vol_lookback_days):i],
                                   rets[b][max(0, i - vol_lookback_days):i]) for b in longs]
                       for a in longs]
                scores = [score_by_name.get(t, 0.5) for t in longs]
                w, gross = target_weights(
                    method=method, vols=vols, cov=cov, scores=scores,
                    max_weight=max_weight, gross_cap=gross_cap, target_vol_pct=target_vol_pct,
                )
                target_val = {t: 0.0 for t in names}
                for t, wi in zip(longs, w):
                    target_val[t] = wi * equity
                turnover_total += sum(abs(target_val[t] - val[t]) for t in names) / equity
                cost_paid = sum(abs(target_val[t] - val[t]) for t in names) * cost
                val = target_val
                cash = equity - sum(val.values()) - cost_paid
            else:
                # nothing long → go to cash (charge turnover to exit)
                turnover_total += sum(val.values()) / equity if equity > 0 else 0.0
                cost_paid = sum(val.values()) * cost
                cash = equity - cost_paid
                val = {t: 0.0 for t in names}
            n_rebalances += 1

        equity = cash + sum(val.values())
        strat_series.append(equity)

        invested = sum(val.values())
        if invested > 1e-9:
            invested_days += 1
            gross_sum += invested / equity if equity > 0 else 0.0
            n_holdings_sum += sum(1 for t in names if val[t] > 1e-12)
            for t in names:
                weight_sum[t] += (val[t] / equity) if equity > 0 else 0.0

        bench_equity = sum(bench_val.values())
        market_val = (spy_closes[i] / spy_closes[0]) if (spy_closes and spy_closes[0] > 0) else None
        equity_curve.append(PortfolioPoint(
            date=dates[i],
            strategy=round(equity, 6),
            benchmark=round(bench_equity, 6),
            market=round(market_val, 6) if market_val is not None else None,
        ))

    metrics = _metrics(
        equity_curve, strat_series, transaction_cost_bps,
        n_rebalances=n_rebalances, turnover_total=turnover_total,
        avg_n_holdings=(n_holdings_sum / invested_days if invested_days else 0.0),
        avg_gross=(gross_sum / invested_days * 100.0 if invested_days else 0.0),
        target_vol_pct=target_vol_pct,
    )
    denom = max(1, invested_days)
    avg_weight = {t: round(weight_sum[t] / denom * 100.0, 2) for t in names}
    long_as_of = {t: in_market_by_name[t][-1] for t in names}
    return equity_curve, metrics, avg_weight, long_as_of


def _metrics(curve, strat, cost_bps, *, n_rebalances, turnover_total,
             avg_n_holdings, avg_gross, target_vol_pct) -> PortfolioMetrics:
    final = strat[-1]
    total_ret = (final - 1.0) * 100.0
    bench_ret = (curve[-1].benchmark - 1.0) * 100.0
    days = (curve[-1].date - curve[0].date).days or 1
    years = days / 365.0
    cagr = (final ** (1.0 / years) - 1.0) * 100.0 if final > 0 and years > 0 else -100.0

    rets = [strat[i] / strat[i - 1] - 1.0 for i in range(1, len(strat)) if strat[i - 1] > 0]
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        sd = math.sqrt(var)
        sharpe = (mean / sd * math.sqrt(_TRADING_DAYS)) if sd > 0 else 0.0
        ann_vol = sd * math.sqrt(_TRADING_DAYS) * 100.0
    else:
        sharpe, ann_vol = 0.0, 0.0

    peak, max_dd = strat[0], 0.0
    for v in strat:
        peak = max(peak, v)
        if peak > 0:
            max_dd = min(max_dd, v / peak - 1.0)

    market_ret = market_excess = None
    if curve[-1].market is not None:
        market_ret = round((curve[-1].market - 1.0) * 100.0, 2)
        market_excess = round(total_ret - market_ret, 2)

    return PortfolioMetrics(
        total_return_pct=round(total_ret, 2),
        benchmark_return_pct=round(bench_ret, 2),
        excess_return_pct=round(total_ret - bench_ret, 2),
        market_return_pct=market_ret,
        excess_vs_market_pct=market_excess,
        cagr_pct=round(cagr, 2),
        sharpe=round(sharpe, 2),
        max_drawdown_pct=round(max_dd * 100.0, 2),
        ann_vol_pct=round(ann_vol, 2),
        target_vol_pct=target_vol_pct,
        avg_n_holdings=round(avg_n_holdings, 2),
        avg_gross_exposure_pct=round(avg_gross, 1),
        n_rebalances=n_rebalances,
        turnover_annual_pct=round(turnover_total / max(years, 1e-9) * 100.0, 1),
        days=days,
        transaction_cost_bps=cost_bps,
    )
