"""Buyback backtest. Pure, deterministic, lookahead-free (signal keyed off filing date)."""

from __future__ import annotations

from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task15_buyback.pipeline.signals import shares_yoy_asof
from task15_buyback.schemas import (
    BacktestResult, BuybackSpec, EquityPoint, PricePoint, SharePoint, Trade,
)


def _wants_long(spec: BuybackSpec, shares: list[SharePoint], d: date) -> bool:
    m = shares_yoy_asof(shares, d)
    if m is None or not m.get("has_yoy"):
        return False
    chg = m["yoy_change_pct"]            # negative = buying back
    if chg is None:
        return False
    if spec.entry_signal == "buy_and_hold":
        return True
    if spec.entry_signal == "buyback":
        return chg <= -spec.reduction_threshold_pct
    if spec.entry_signal == "aggressive_buyback":
        return chg <= -2.0 * spec.reduction_threshold_pct
    return False


def run_buyback_backtest(
    prices: list[PricePoint], shares: list[SharePoint], spec: BuybackSpec, *, start: date,
    transaction_cost_bps: float = 10.0, market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    window = [p for p in prices if p.date >= start]
    if len(window) < 2:
        raise RuntimeError("insufficient price history in the backtest window")
    opens = [p.open for p in window]
    closes = [p.close for p in window]
    lows = [p.low for p in window]
    n = len(window)
    cost = transaction_cost_bps / 10_000.0

    cash, equity = 1.0, 1.0
    position = 0.0
    entry_price: float | None = None
    entry_idx: int | None = None
    trades: list[Trade] = []
    curve: list[EquityPoint] = []
    days_in = 0
    bench_entry = opens[1]
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0

    for i in range(n):
        d = window[i].date
        if position > 0:
            equity = position * closes[i]; days_in += 1
        else:
            equity = cash
        can = i + 1 < n
        ep = opens[i + 1] if can else None

        if position > 0:
            assert entry_price is not None and entry_idx is not None
            reason = ""; fp: float | None = None; fd = d
            if spec.stop_loss_pct > 0:
                stop = entry_price * (1 - spec.stop_loss_pct / 100.0)
                if lows[i] <= stop:
                    reason, fp = "stop_loss", min(opens[i], stop)
            if not reason and can:
                if spec.exit_signal == "time_exit" and i - entry_idx >= spec.holding_days:
                    reason = "time_exit"
                elif spec.exit_signal == "stops_buyback" and not _wants_long(spec, shares, d):
                    reason = "signal"
                if reason:
                    fp, fd = ep, window[i + 1].date
            if reason and fp is not None:
                net = fp * (1 - cost); cash = position * net
                trades[-1].exit_date = fd; trades[-1].exit_price = round(fp, 4)
                trades[-1].return_pct = round((net / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
                trades[-1].exit_reason = reason
                position, entry_price, entry_idx = 0.0, None, None; equity = cash
        elif can and _wants_long(spec, shares, d):
            fill = ep * (1 + cost); position = cash / fill; entry_price, entry_idx = ep, i + 1
            trades.append(Trade(entry_date=window[i + 1].date, entry_price=round(ep, 4))); cash = 0.0

        if mkt_entry:
            if i == 0:
                mv: float | None = 1.0
            else:
                if window[i].date in mkt_close:
                    last_mkt = mkt_close[window[i].date] / mkt_entry
                mv = round(last_mkt, 6)
        else:
            mv = None
        curve.append(EquityPoint(date=d, strategy=round(equity, 6),
                                 benchmark=1.0 if i == 0 else round(closes[i] / bench_entry, 6), market=mv))

    if position > 0 and entry_price is not None:
        net = closes[-1] * (1 - cost)
        trades[-1].exit_date = window[-1].date; trades[-1].exit_price = round(closes[-1], 4)
        trades[-1].return_pct = round((net / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
        trades[-1].exit_reason = "end_of_data"; curve[-1].strategy = round(position * net, 6)

    metrics = _metrics(curve, trades, closes, days_in, transaction_cost_bps)
    return BacktestResult(start_date=window[0].date, end_date=window[-1].date,
                          metrics=metrics, trades=trades, equity_curve=curve)
