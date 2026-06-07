"""Seasonality backtest. Pure, deterministic, lookahead-free (calendar-driven).

The long/flat decision for bar i is a pure calendar rule (known in advance),
decided at close i and executed at open i+1. Metrics reuse Task 4's `_metrics`.
"""

from __future__ import annotations

from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task12_seasonality.pipeline.signals import wants_long
from task12_seasonality.schemas import (
    BacktestResult,
    EquityPoint,
    PricePoint,
    SeasonalSpec,
    Trade,
)


def run_seasonal_backtest(
    prices: list[PricePoint],
    spec: SeasonalSpec,
    *,
    start: date,
    transaction_cost_bps: float = 10.0,
    market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    full = prices
    idxs = [j for j, p in enumerate(full) if p.date >= start]
    if len(idxs) < 2:
        raise RuntimeError("insufficient price history in the backtest window")
    base = idxs[0]
    window = [full[j] for j in idxs]
    opens = [p.open for p in window]
    closes = [p.close for p in window]
    n = len(window)
    cost = transaction_cost_bps / 10_000.0

    cash, equity = 1.0, 1.0
    position = 0.0
    entry_price: float | None = None
    trades: list[Trade] = []
    equity_curve: list[EquityPoint] = []
    days_in_market = 0

    bench_entry = opens[1]
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0

    for i in range(n):
        if position > 0:
            equity = position * closes[i]
            days_in_market += 1
        else:
            equity = cash
        can_execute = i + 1 < n
        exec_price = opens[i + 1] if can_execute else None

        if can_execute:
            want = wants_long(full, base + i, spec)
            if position > 0 and not want:
                net_fill = exec_price * (1 - cost)
                cash = position * net_fill
                trades[-1].exit_date = window[i + 1].date
                trades[-1].exit_price = round(exec_price, 4)
                trades[-1].return_pct = round((net_fill / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
                trades[-1].exit_reason = "signal"
                position, entry_price = 0.0, None
                equity = cash
            elif position == 0 and want:
                fill = exec_price * (1 + cost)
                position = cash / fill
                entry_price = exec_price
                trades.append(Trade(entry_date=window[i + 1].date, entry_price=round(exec_price, 4)))
                cash = 0.0

        if mkt_entry:
            if i == 0:
                market_val: float | None = 1.0
            else:
                if window[i].date in mkt_close:
                    last_mkt = mkt_close[window[i].date] / mkt_entry
                market_val = round(last_mkt, 6)
        else:
            market_val = None

        equity_curve.append(EquityPoint(
            date=window[i].date, strategy=round(equity, 6),
            benchmark=1.0 if i == 0 else round(closes[i] / bench_entry, 6),
            market=market_val,
        ))

    if position > 0 and entry_price is not None:
        net_fill = closes[-1] * (1 - cost)
        trades[-1].exit_date = window[-1].date
        trades[-1].exit_price = round(closes[-1], 4)
        trades[-1].return_pct = round((net_fill / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
        trades[-1].exit_reason = "end_of_data"
        equity_curve[-1].strategy = round(position * net_fill, 6)

    metrics = _metrics(equity_curve, trades, closes, days_in_market, transaction_cost_bps)
    return BacktestResult(
        start_date=window[0].date, end_date=window[-1].date,
        metrics=metrics, trades=trades, equity_curve=equity_curve,
    )
