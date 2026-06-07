"""Event-driven earnings (PEAD) backtest. Pure, deterministic, lookahead-free.

A qualifying earnings event becomes actionable at the first open AFTER its 8-K
filing date (never the same bar), so the backtest can only act once the release
was public. Position is in the stock (long/flat); the event decides entry, and a
time horizon / next-earnings / stop decides the exit. Metrics reuse Task 4's
`_metrics` for consistency with the other agents.
"""

from __future__ import annotations

from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task8_earnings.schemas import (
    BacktestResult,
    EarningsEvent,
    EarningsSpec,
    EquityPoint,
    PricePoint,
    Trade,
)


def _qualifies(spec: EarningsSpec, e: EarningsEvent) -> bool:
    sig = spec.entry_signal
    if sig == "any_earnings":
        return True
    if sig == "bullish":
        return e.sentiment == "bullish"
    if sig == "bullish_or_raised":
        return e.sentiment == "bullish" or e.guidance == "raised"
    if sig == "beat":
        return e.beat_miss == "beat"
    return False


def _trigger_bar(window: list[PricePoint], filing_date: date) -> int | None:
    """The bar whose close is the decision point — the last bar with date <=
    filing_date. Entry then fills at the NEXT open (strictly after the filing)."""
    idx = None
    for i, p in enumerate(window):
        if p.date <= filing_date:
            idx = i
        else:
            break
    return idx


def run_earnings_backtest(
    prices: list[PricePoint],
    events: list[EarningsEvent],
    spec: EarningsSpec,
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

    entry_bars = {b for e in events if _qualifies(spec, e)
                  if (b := _trigger_bar(window, e.filing_date)) is not None}
    all_event_bars = sorted({b for e in events
                             if (b := _trigger_bar(window, e.filing_date)) is not None})

    def _next_event_bar(after: int) -> int | None:
        return next((b for b in all_event_bars if b > after), None)

    cash, equity = 1.0, 1.0
    position = 0.0
    entry_price: float | None = None
    entry_idx: int | None = None          # fill bar of the current entry
    entry_trigger: int | None = None      # the trigger bar that opened it
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
                elif spec.exit_signal == "next_earnings" and entry_trigger is not None \
                        and (ne := _next_event_bar(entry_trigger)) is not None and i >= ne:
                    exit_reason = "next_earnings"
                if exit_reason:
                    fill_price, fill_date = exec_price, window[i + 1].date

            if exit_reason and fill_price is not None:
                net_fill = fill_price * (1 - cost)
                cash = position * net_fill
                trades[-1].exit_date = fill_date
                trades[-1].exit_price = round(fill_price, 4)
                trades[-1].return_pct = round((net_fill / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
                trades[-1].exit_reason = exit_reason
                position, entry_price, entry_idx, entry_trigger = 0.0, None, None, None
                equity = cash

        elif can_execute and i in entry_bars:
            fill = exec_price * (1 + cost)
            position = cash / fill
            entry_price, entry_idx, entry_trigger = exec_price, i + 1, i
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
