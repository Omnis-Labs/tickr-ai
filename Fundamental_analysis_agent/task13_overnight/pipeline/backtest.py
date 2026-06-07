"""Overnight/intraday (gap) decomposition + backtest. Pure, deterministic, lookahead-free.

Each day i (i>=1): overnight return = open[i]/close[i-1] − 1, intraday = close[i]/open[i] − 1.
The participation rule for day i is known by the prior close, so it's lookahead-free.
Overnight-only / intraday-only trade EVERY day (round-trip cost daily), which the
honest backtest charges. Has its own metrics (a per-day strategy, not discrete
position episodes).
"""

from __future__ import annotations

import math
from datetime import date

from task13_overnight.schemas import (
    BacktestMetrics,
    BacktestResult,
    EquityPoint,
    GapSpec,
    PricePoint,
)

_TRADING_DAYS = 252


def gap_readings(prices: list[PricePoint]) -> dict[str, float | str]:
    on, intra = [], []
    for i in range(1, len(prices)):
        if prices[i - 1].close > 0 and prices[i].open > 0:
            on.append(prices[i].open / prices[i - 1].close - 1.0)
            intra.append(prices[i].close / prices[i].open - 1.0)

    def _ann(rs):
        return (sum(rs) / len(rs) * _TRADING_DAYS * 100.0) if rs else 0.0

    on_ann, intra_ann = _ann(on), _ann(intra)
    return {
        "overnight_ann_pct": round(on_ann, 1),
        "intraday_ann_pct": round(intra_ann, 1),
        "overnight_share": ("dominant" if on_ann > abs(intra_ann) and on_ann > 0 else "weak"),
        "overnight_win_rate_pct": round(sum(1 for r in on if r > 0) / len(on) * 100.0, 1) if on else 0.0,
        "n_days": float(len(on)),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["n_days", "overnight_ann_pct", "intraday_ann_pct", "overnight_share", "overnight_win_rate_pct"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def run_gap_backtest(
    prices: list[PricePoint],
    spec: GapSpec,
    *,
    start: date,
    transaction_cost_bps: float = 10.0,
    market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    window = [p for p in prices if p.date >= start]
    if len(window) < 3:
        raise RuntimeError("insufficient price history in the backtest window")
    closes = [p.close for p in window]
    opens = [p.open for p in window]
    n = len(window)
    cost = transaction_cost_bps / 10_000.0
    rt = (1 - cost) ** 2          # round-trip (enter+exit) cost factor for a one-day hold

    equity = 1.0
    strat: list[float] = []
    daily_rets: list[float] = []
    participating_days = 0
    n_trades = 0
    sig = spec.entry_signal

    bench_entry = opens[1]
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0
    curve: list[EquityPoint] = []

    # buy_and_hold tracked separately (continuous position, cost only at entry/exit)
    bh_shares = 0.0
    bh_cash = 1.0

    for i in range(n):
        r = 0.0
        traded = False
        if i >= 1 and closes[i - 1] > 0 and opens[i] > 0:
            if sig == "overnight":
                r, traded = opens[i] / closes[i - 1] - 1.0, True
            elif sig == "intraday":
                r, traded = closes[i] / opens[i] - 1.0, True
            elif sig == "overnight_after_up":
                if i >= 2 and closes[i - 1] > closes[i - 2]:
                    r, traded = opens[i] / closes[i - 1] - 1.0, True

        if sig == "buy_and_hold":
            if i == 1:
                bh_shares = bh_cash / (opens[1] * (1 + cost)); bh_cash = 0.0  # enter at first open
            equity = (bh_shares * closes[i]) if bh_shares > 0 else bh_cash
            if i >= 1:
                participating_days += 1
        else:
            if traded:
                equity *= (1 + r) * rt
                daily_rets.append((1 + r) * rt - 1.0)
                participating_days += 1
                n_trades += 1
        strat.append(equity)

        if mkt_entry:
            if i == 0:
                mv: float | None = 1.0
            else:
                if window[i].date in mkt_close:
                    last_mkt = mkt_close[window[i].date] / mkt_entry
                mv = round(last_mkt, 6)
        else:
            mv = None
        curve.append(EquityPoint(
            date=window[i].date, strategy=round(equity, 6),
            benchmark=1.0 if i == 0 else round(closes[i] / bench_entry, 6),
            market=round(mv, 6) if mv is not None else None,
        ))

    if sig == "buy_and_hold":
        n_trades = 1
        daily_rets = [strat[i] / strat[i - 1] - 1.0 for i in range(1, n) if strat[i - 1] > 0]

    metrics = _gap_metrics(curve, strat, daily_rets, participating_days, n_trades, transaction_cost_bps)
    return BacktestResult(start_date=window[0].date, end_date=window[-1].date,
                          metrics=metrics, trades=[], equity_curve=curve)


def _gap_metrics(curve, strat, rets, participating_days, n_trades, cost_bps) -> BacktestMetrics:
    final = strat[-1]
    total = (final - 1.0) * 100.0
    bench = (curve[-1].benchmark - 1.0) * 100.0
    days = (curve[-1].date - curve[0].date).days or 1
    cagr = (final ** (365.0 / days) - 1.0) * 100.0 if final > 0 else -100.0
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
    win = (sum(1 for r in rets if r > 0) / len(rets) * 100.0) if rets else 0.0
    market_ret = market_excess = None
    if curve[-1].market is not None:
        market_ret = round((curve[-1].market - 1.0) * 100.0, 2)
        market_excess = round(total - market_ret, 2)
    return BacktestMetrics(
        total_return_pct=round(total, 2), benchmark_return_pct=round(bench, 2),
        excess_return_pct=round(total - bench, 2),
        market_return_pct=market_ret, excess_vs_market_pct=market_excess,
        cagr_pct=round(cagr, 2), sharpe=round(sharpe, 2), max_drawdown_pct=round(mdd * 100, 2),
        win_rate_pct=round(win, 1), n_trades=n_trades,
        exposure_pct=round(participating_days / max(1, len(curve)) * 100.0, 1),
        days=days, transaction_cost_bps=cost_bps,
    )
