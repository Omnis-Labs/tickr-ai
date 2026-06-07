"""Relative-strength backtest. Pure, deterministic, lookahead-free.

Same execution contract as Task 3/4: a signal computed from RS up to the close of
bar i is executed at the open of bar i+1. The position is in the TICKER (long /
flat); the *signal* comes from the ticker's relative strength vs its sector ETF.
Metrics reuse Task 4's `_metrics` so the numbers match the other agents.
"""

from __future__ import annotations

from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task7_relative.pipeline.indicators import align_rs, prior_high, sma_none
from task7_relative.schemas import (
    BacktestResult,
    EquityPoint,
    PricePoint,
    RelativeSpec,
    Trade,
)


def _wants_long(spec: RelativeSpec, i: int, rs: list[float | None],
                rs_sma: list[float | None], rs_high: list[float | None]) -> bool | None:
    sig = spec.entry_signal
    if sig == "buy_and_hold":
        return True
    if sig == "rs_uptrend":
        r, s = rs[i], rs_sma[i]
        return None if (r is None or s is None) else r > s
    if sig == "rs_breakout":
        r, h = rs[i], rs_high[i]
        return None if (r is None or h is None) else r > h
    if sig == "rs_momentum":
        lb = spec.rs_momentum_lookback_days
        if i < lb or rs[i] is None or rs[i - lb] is None or rs[i - lb] == 0:
            return None
        return (rs[i] / rs[i - lb] - 1.0) * 100.0 >= spec.rs_momentum_threshold_pct  # type: ignore[operator]
    return None


def _exit_triggered(spec: RelativeSpec, i: int, rs: list[float | None],
                    rs_sma: list[float | None]) -> bool:
    if spec.exit_signal == "rs_downtrend":
        r, s = rs[i], rs_sma[i]
        return r is not None and s is not None and r < s
    return False


def run_relative_backtest(
    ticker_prices: list[PricePoint],
    benchmark_prices: list[PricePoint],
    spec: RelativeSpec,
    *,
    start: date,
    transaction_cost_bps: float = 10.0,
    market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    # RS computed on the FULL history (so trailing SMAs are warm at the window start),
    # then sliced to the backtest window.
    rs_full = align_rs(ticker_prices, benchmark_prices)
    sma_full = sma_none(rs_full, spec.rs_sma)
    high_full = prior_high(rs_full, spec.rs_high_lookback)

    idx = [j for j, p in enumerate(ticker_prices) if p.date >= start]
    if len(idx) < 2:
        raise RuntimeError("insufficient price history in the backtest window")
    window = [ticker_prices[j] for j in idx]
    rs = [rs_full[j] for j in idx]
    rs_sma = [sma_full[j] for j in idx]
    rs_high = [high_full[j] for j in idx]

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
            fill_date = window[i].date
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
                elif _exit_triggered(spec, i, rs, rs_sma):
                    exit_reason = "signal"
                elif _wants_long(spec, i, rs, rs_sma, rs_high) is False:
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

        elif can_execute:
            if _wants_long(spec, i, rs, rs_sma, rs_high):
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
            date=window[i].date,
            strategy=round(equity, 6),
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
        start_date=window[0].date,
        end_date=window[-1].date,
        metrics=metrics,
        trades=trades,
        equity_curve=equity_curve,
    )
