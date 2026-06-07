"""Pairs-trading math + market-neutral backtest. Pure, deterministic, lookahead-free.

β (hedge ratio) and the z-score's mean/std are estimated over a trailing window of
data STRICTLY BEFORE each bar. The spread value at bar i uses that bar's closes (known
at close i) with the prior-window β; the resulting z drives a signal at close i that
executes at open i+1. The book is dollar-neutral: +1 = long A / short B (0.5 gross each
side), −1 = the reverse.
"""

from __future__ import annotations

import math
from datetime import date

from task4_technical.schemas import BacktestMetrics, BacktestResult, EquityPoint, Trade

_TRADING_DAYS = 252


def _ols_beta(xs: list[float], ys: list[float]) -> float:
    """Slope of y on x (β so that logA ≈ α + β·logB → x=logB, y=logA)."""
    n = min(len(xs), len(ys))
    if n < 2:
        return 1.0
    mx = sum(xs) / n
    my = sum(ys) / n
    var = sum((x - mx) ** 2 for x in xs)
    if var <= 1e-12:
        return 1.0
    cov = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    return cov / var


def _half_life(spread: list[float]) -> float:
    """Mean-reversion half-life from an AR(1): Δs_t = a + b·s_{t-1}. ∞ if non-mean-reverting."""
    if len(spread) < 4:
        return 0.0
    s_prev = spread[:-1]
    ds = [spread[i] - spread[i - 1] for i in range(1, len(spread))]
    b = _ols_beta(s_prev, ds)               # slope of Δs on s_{t-1}
    if b >= 0 or (1 + b) <= 0:
        return 0.0                          # not mean-reverting
    return -math.log(2) / math.log(1 + b)


def compute_z_series(
    closes_a: list[float], closes_b: list[float], window: int,
) -> tuple[list[float | None], list[float | None]]:
    """Per-bar (z_i, beta_i), each using the window of bars strictly before i."""
    la = [math.log(c) if c > 0 else 0.0 for c in closes_a]
    lb = [math.log(c) if c > 0 else 0.0 for c in closes_b]
    n = len(la)
    zs: list[float | None] = [None] * n
    betas: list[float | None] = [None] * n
    for i in range(n):
        if i < window:
            continue
        xs = lb[i - window:i]               # strictly before i
        ys = la[i - window:i]
        beta = _ols_beta(xs, ys)
        sp_win = [ys[k] - beta * xs[k] for k in range(len(xs))]
        mean = sum(sp_win) / len(sp_win)
        var = sum((s - mean) ** 2 for s in sp_win) / (len(sp_win) - 1) if len(sp_win) > 1 else 0.0
        sd = math.sqrt(var)
        if sd <= 1e-9:
            continue
        spread_now = la[i] - beta * lb[i]   # uses close i (known at decision time)
        zs[i] = (spread_now - mean) / sd
        betas[i] = beta
    return zs, betas


def pair_readings(
    closes_a: list[float], closes_b: list[float], zs: list[float | None],
    betas: list[float | None], window: int,
) -> dict[str, float | str]:
    ra = [closes_a[i] / closes_a[i - 1] - 1.0 for i in range(1, len(closes_a)) if closes_a[i - 1] > 0]
    rb = [closes_b[i] / closes_b[i - 1] - 1.0 for i in range(1, len(closes_b)) if closes_b[i - 1] > 0]
    m = min(len(ra), len(rb))
    corr = 0.0
    if m > 2:
        a, b = ra[-m:], rb[-m:]
        ma, mb = sum(a) / m, sum(b) / m
        va = sum((x - ma) ** 2 for x in a)
        vb = sum((x - mb) ** 2 for x in b)
        if va > 1e-12 and vb > 1e-12:
            corr = sum((a[i] - ma) * (b[i] - mb) for i in range(m)) / math.sqrt(va * vb)
    cur_z = next((z for z in reversed(zs) if z is not None), None)
    cur_beta = next((bt for bt in reversed(betas) if bt is not None), None)
    la = [math.log(c) if c > 0 else 0.0 for c in closes_a][-window:]
    lb = [math.log(c) if c > 0 else 0.0 for c in closes_b][-window:]
    bt = cur_beta if cur_beta is not None else 1.0
    hl = _half_life([la[k] - bt * lb[k] for k in range(min(len(la), len(lb)))])
    az = abs(cur_z) if cur_z is not None else 0.0
    regime = "stretched" if az >= 2.0 else "diverging" if az >= 1.0 else "tight"
    return {
        "spread_regime": regime,
        "return_correlation": round(corr, 2),
        "current_z_score": round(cur_z, 2) if cur_z is not None else 0.0,
        "hedge_ratio_beta": round(cur_beta, 3) if cur_beta is not None else 0.0,
        "half_life_days": round(hl, 1) if hl and hl < 1e4 else 0.0,
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["spread_regime", "return_correlation", "current_z_score", "hedge_ratio_beta", "half_life_days"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def _metrics_from_curve(
    strat: list[float], basket: list[float], spy: list[float | None], dates: list[date],
    trades: list[Trade], in_market_days: int, cost_bps: float,
) -> BacktestMetrics:
    final = strat[-1]
    total = (final - 1.0) * 100.0
    bench = (basket[-1] - 1.0) * 100.0
    days = (dates[-1] - dates[0]).days or 1
    years = days / 365.0
    cagr = (final ** (1.0 / years) - 1.0) * 100.0 if final > 0 and years > 0 else -100.0
    rets = [strat[i] / strat[i - 1] - 1.0 for i in range(1, len(strat)) if strat[i - 1] > 0]
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        sd = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1))
        sharpe = (mean / sd * math.sqrt(_TRADING_DAYS)) if sd > 0 else 0.0
    else:
        sharpe = 0.0
    peak, mdd = strat[0], 0.0
    for v in strat:
        peak = max(peak, v)
        if peak > 0:
            mdd = min(mdd, v / peak - 1.0)
    closed = [t for t in trades if t.return_pct is not None]
    wins = sum(1 for t in closed if (t.return_pct or 0) > 0)
    win_rate = (wins / len(closed) * 100.0) if closed else 0.0
    mkt = next((v for v in reversed(spy) if v is not None), None)
    mret = (mkt - 1.0) * 100.0 if mkt is not None else None
    return BacktestMetrics(
        total_return_pct=round(total, 2), benchmark_return_pct=round(bench, 2),
        excess_return_pct=round(total - bench, 2),
        benchmark_from_entry_pct=None, excess_vs_entry_pct=None,
        market_return_pct=round(mret, 2) if mret is not None else None,
        excess_vs_market_pct=round(total - mret, 2) if mret is not None else None,
        cagr_pct=round(cagr, 2), sharpe=round(sharpe, 2), max_drawdown_pct=round(mdd * 100.0, 2),
        win_rate_pct=round(win_rate, 1), n_trades=len(closed),
        exposure_pct=round(in_market_days / max(1, len(strat)) * 100.0, 1),
        days=days, transaction_cost_bps=cost_bps,
    )


def run_pairs_backtest(
    dates: list[date], closes_a: list[float], closes_b: list[float], spec, *,
    transaction_cost_bps: float = 10.0, spy_closes: list[float] | None = None,
) -> BacktestResult:
    n = len(dates)
    if n < spec.formation_window + 5:
        raise RuntimeError("insufficient overlapping history for a pairs backtest")
    zs, _betas = compute_z_series(closes_a, closes_b, spec.formation_window)
    ra = [0.0] + [closes_a[i] / closes_a[i - 1] - 1.0 if closes_a[i - 1] > 0 else 0.0 for i in range(1, n)]
    rb = [0.0] + [closes_b[i] / closes_b[i - 1] - 1.0 if closes_b[i - 1] > 0 else 0.0 for i in range(1, n)]
    cost = transaction_cost_bps / 10_000.0

    equity = 1.0
    pos = 0                     # position active during the CURRENT bar's return
    held = 0
    strat, basket, mkt = [], [], []
    trades: list[Trade] = []
    in_market_days = 0
    spy_entry = spy_closes[1] if spy_closes and len(spy_closes) > 1 and spy_closes[1] > 0 else None
    a0, b0 = closes_a[0], closes_b[0]

    for i in range(n):
        if i > 0 and pos != 0:
            equity *= (1.0 + pos * 0.5 * (ra[i] - rb[i]))
            held += 1
            in_market_days += 1
        z = zs[i]
        target = pos
        if pos == 0:
            if z is not None and z <= -spec.z_entry:
                target = 1                      # spread cheap → long A / short B
            elif z is not None and z >= spec.z_entry:
                target = -1                     # spread rich → short A / long B
        else:
            blew = z is not None and abs(z) >= spec.stop_z
            reverted = z is not None and abs(z) <= spec.z_exit
            if reverted or blew or held >= spec.max_holding_days:
                target = 0
        if target != pos:
            equity *= (1.0 - cost * abs(target - pos) * 1.0)    # turnover on 1.0 gross per unit
            if pos == 0 and target != 0:                         # opening
                trades.append(Trade(entry_date=dates[min(i + 1, n - 1)],
                                    entry_price=round(z, 4) if z is not None else 0.0))
                held = 0
            elif pos != 0 and target == 0 and trades:            # closing
                t = trades[-1]
                t.exit_date = dates[min(i + 1, n - 1)]
                t.exit_price = round(z, 4) if z is not None else 0.0
                t.exit_reason = ("reverted" if (z is not None and abs(z) <= spec.z_exit)
                                 else "stop_z" if (z is not None and abs(z) >= spec.stop_z) else "time_exit")
            pos = target

        strat.append(round(equity, 6))
        basket.append(round(0.5 * (closes_a[i] / a0) + 0.5 * (closes_b[i] / b0), 6) if a0 > 0 and b0 > 0 else 1.0)
        if spy_entry and spy_closes and i < len(spy_closes) and spy_closes[i] > 0:
            mkt.append(round(spy_closes[i] / spy_entry, 6) if i > 0 else 1.0)
        else:
            mkt.append(None)

    # per-trade round-trip return from the strategy curve at entry/exit bars
    date_to_idx = {d: k for k, d in enumerate(dates)}
    for t in trades:
        ei = date_to_idx.get(t.entry_date)
        xi = date_to_idx.get(t.exit_date) if t.exit_date else None
        if ei is not None and xi is not None and ei < xi and strat[ei] > 0:
            t.return_pct = round((strat[xi] / strat[ei] - 1.0) * 100.0, 4)
        elif t.exit_date is None:
            t.exit_reason = "open_at_end"

    metrics = _metrics_from_curve(strat, basket, mkt, dates, trades, in_market_days, transaction_cost_bps)
    curve = [EquityPoint(date=dates[i], strategy=strat[i], benchmark=basket[i], market=mkt[i]) for i in range(n)]
    return BacktestResult(start_date=dates[0], end_date=dates[-1], metrics=metrics,
                          trades=[t for t in trades if t.exit_date or t.entry_date], equity_curve=curve)
