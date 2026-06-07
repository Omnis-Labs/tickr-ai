"""Fundamentals-trend backtest. Pure, deterministic, lookahead-free.

The signal changes only on filing dates (`filed`), and `metrics_asof` only reads
quarters filed on/before the bar's date — so the backtest can act on fundamentals
only once they were public. Signal at close i executes at open i+1. Long-only;
metrics reuse Task 4's `_metrics`.
"""

from __future__ import annotations

from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task11_fundamentals_trend.pipeline.signals import metrics_asof
from task11_fundamentals_trend.schemas import (
    BacktestResult,
    EquityPoint,
    FundTrendSpec,
    PricePoint,
    QuarterPoint,
    Trade,
)


def _wants_long(spec: FundTrendSpec, quarters: list[QuarterPoint], d: date) -> bool:
    m = metrics_asof(quarters, d)
    if m is None or not m["has_yoy"]:
        return False
    rev, ni, mc = m["revenue_yoy_pct"], m["earnings_yoy_pct"], m["margin_yoy_change_pp"]
    rev_ok = rev is not None and rev >= spec.revenue_growth_threshold_pct
    ni_ok = ni is not None and ni >= spec.earnings_growth_threshold_pct
    margin_ok = mc is not None and mc > 0
    sig = spec.entry_signal
    if sig == "revenue_growth":
        return rev_ok
    if sig == "earnings_growth":
        return ni_ok
    if sig == "margin_expansion":
        return margin_ok
    if sig == "growth_and_margin":
        return rev_ok and margin_ok
    if sig == "any_improving":
        return (rev is not None and rev > 0) or (ni is not None and ni > 0)
    return False


def run_fundtrend_backtest(
    prices: list[PricePoint],
    quarters: list[QuarterPoint],
    spec: FundTrendSpec,
    *,
    start: date,
    transaction_cost_bps: float = 10.0,
    market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    window = [p for p in prices if p.date >= start]
    if len(window) < 2:
        raise RuntimeError("insufficient price history in the backtest window")

    opens = [p.open for p in window]
    closes = [p.close for p in window]
    highs = [p.high for p in window]
    lows = [p.low for p in window]
    n = len(window)
    cost = transaction_cost_bps / 10_000.0

    cash, equity = 1.0, 1.0
    position = 0.0
    entry_price: float | None = None
    entry_idx: int | None = None
    trades: list[Trade] = []
    equity_curve: list[EquityPoint] = []
    days_in_market = 0

    bench_entry = opens[1]
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0

    for i in range(n):
        d = window[i].date
        if position > 0:
            equity = position * closes[i]
            days_in_market += 1
        else:
            equity = cash

        can_execute = i + 1 < n
        exec_price = opens[i + 1] if can_execute else None

        if position > 0:
            assert entry_price is not None and entry_idx is not None
            exit_reason = ""
            fill_price: float | None = None
            fill_date = d
            if spec.stop_loss_pct > 0:
                stop = entry_price * (1 - spec.stop_loss_pct / 100.0)
                if lows[i] <= stop:
                    exit_reason, fill_price = "stop_loss", min(opens[i], stop)
            if not exit_reason and spec.take_profit_pct > 0:
                tp = entry_price * (1 + spec.take_profit_pct / 100.0)
                if highs[i] >= tp:
                    exit_reason, fill_price = "take_profit", max(opens[i], tp)
            if not exit_reason and can_execute:
                if spec.exit_signal == "time_exit" and i - entry_idx >= spec.holding_days:
                    exit_reason = "time_exit"
                elif spec.exit_signal == "deteriorating" and not _wants_long(spec, quarters, d):
                    exit_reason = "signal"
                if exit_reason:
                    fill_price, fill_date = exec_price, window[i + 1].date

            if exit_reason and fill_price is not None:
                net_fill = fill_price * (1 - cost)
                cash = position * net_fill
                trades[-1].exit_date = fill_date
                trades[-1].exit_price = round(fill_price, 4)
                trades[-1].return_pct = round((net_fill / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
                trades[-1].exit_reason = exit_reason
                position, entry_price, entry_idx = 0.0, None, None
                equity = cash

        elif can_execute and _wants_long(spec, quarters, d):
            fill = exec_price * (1 + cost)
            position = cash / fill
            entry_price, entry_idx = exec_price, i + 1
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
            date=d, strategy=round(equity, 6),
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
