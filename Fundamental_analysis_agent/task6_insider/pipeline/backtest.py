"""Insider-signal backtest engine. Pure, deterministic, lookahead-free.

Same execution contract as Task 3/4: a signal is computed from information known
at the **close of bar i** and executed at the **open of bar i+1** — never the same
bar, never a future bar. Here the "information" is the trailing insider flow,
keyed off Form 4 *filing* dates, so the backtest can only act on an insider trade
once its Form 4 was public.

Long-only / fully-invested-or-flat. The LLM's thesis selects the signal and
parameters; this engine only executes them. Metrics (Sharpe, drawdown, alpha vs
S&P 500, entry-aligned benchmark) reuse Task 4's `_metrics` verbatim so the
numbers are defined identically to the other agents.
"""

from __future__ import annotations

from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task6_insider.pipeline.signals import flow_asof
from task6_insider.schemas import (
    BacktestResult,
    EquityPoint,
    InsiderSpec,
    InsiderTxn,
    PricePoint,
    Trade,
)


def _wants_long(spec: InsiderSpec, flow: dict[str, float]) -> bool:
    sig = spec.entry_signal
    if sig == "buy_and_hold":
        return True
    if sig == "any_insider_buy":
        return flow["buy_count"] >= 1
    if sig == "cluster_buy":
        return flow["distinct_buyers"] >= spec.min_distinct_buyers and flow["net_value_usd"] > 0
    if sig == "net_value_buy":
        return flow["net_value_usd"] >= spec.min_net_value_usd
    return False


def _exit_triggered(spec: InsiderSpec, flow: dict[str, float]) -> bool:
    if spec.exit_signal == "net_sell":
        return flow["net_value_usd"] < 0
    return False  # "hold" / "time_exit" handled by the position loop


def run_insider_backtest(
    prices: list[PricePoint],
    txns: list[InsiderTxn],
    spec: InsiderSpec,
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

    # Precompute the as-of insider flow at each bar's close (lookahead-free).
    flows = [flow_asof(txns, window[i].date, spec.lookback_days) for i in range(n)]

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
            # intrabar risk overlay on day i
            if spec.stop_loss_pct > 0:
                stop = entry_price * (1 - spec.stop_loss_pct / 100.0)
                if lows[i] <= stop:
                    exit_reason, fill_price = "stop_loss", min(opens[i], stop)
            if not exit_reason and spec.take_profit_pct > 0:
                tp = entry_price * (1 + spec.take_profit_pct / 100.0)
                if highs[i] >= tp:
                    exit_reason, fill_price = "take_profit", max(opens[i], tp)
            # signal / time exits — decided on close i, filled at open i+1
            if not exit_reason and can_execute:
                if spec.exit_signal == "time_exit" and i - entry_idx >= spec.holding_days:
                    exit_reason = "time_exit"
                elif _exit_triggered(spec, flows[i]):
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
            if _wants_long(spec, flows[i]):
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
