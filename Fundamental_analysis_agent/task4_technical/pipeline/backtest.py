"""Trailing-window backtest engine for the technical agent. Pure, deterministic.

This is Task 3's proven position loop and metrics, copied verbatim so the two
agents stay decoupled, with one change: the entry/exit *dispatch* understands the
expanded technical menu (MACD, Bollinger, Donchian, volume confirmation) instead
of Task 3's three signals. Every other property is preserved unchanged:

  * **Lookahead-free.** A signal is computed from closes up to and including day
    *t* and executed at the **open of day t+1** — never the same bar, never a
    future bar. The window starts at `start` (the backtest boundary).
  * **Costs modelled.** A transaction cost (default 10 bps) on every entry/exit.
  * **Honest benchmark.** Reported against buy-and-hold of the same stock over
    the identical window (anchored at the first actionable open), plus an
    entry-aligned benchmark and the S&P 500.

Long-only / fully-invested-or-flat. The LLM's technical thesis selects the
strategy and parameters; this engine only executes them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

from task4_technical.pipeline.indicators import (
    bollinger,
    donchian,
    macd,
    rsi as rsi_series,
    sma,
    volume_ratio,
)
from task4_technical.schemas import (
    BacktestMetrics,
    BacktestResult,
    EquityPoint,
    PricePoint,
    TechnicalSpec,
    Trade,
)

_TRADING_DAYS = 252


@dataclass
class _Ind:
    """Precomputed indicator series, each aligned to the window's closes."""

    sma_f: list[float | None]
    sma_s: list[float | None]
    rsi: list[float | None]
    macd_l: list[float | None]
    macd_s: list[float | None]
    bb_mid: list[float | None]
    bb_up: list[float | None]
    bb_lo: list[float | None]
    dc_up: list[float | None]
    dc_lo: list[float | None]
    vol_r: list[float | None]


def _wants_to_be_long(spec: TechnicalSpec, i: int, closes: list[float], ind: _Ind) -> bool | None:
    """Desired position at the *close* of bar i (acted on at open of i+1).
    Returns None when the entry signal is undefined (warm-up) → treat as flat."""
    sig = spec.entry_signal
    base: bool | None
    if sig == "buy_and_hold":
        base = True
    elif sig == "sma_cross":
        f, s = ind.sma_f[i], ind.sma_s[i]
        base = None if (f is None or s is None) else f > s
    elif sig == "macd_cross":
        line, signal = ind.macd_l[i], ind.macd_s[i]
        base = None if (line is None or signal is None) else line > signal
    elif sig == "rsi_oversold":
        r = ind.rsi[i]
        base = None if r is None else r <= spec.rsi_oversold
    elif sig == "bollinger_breakout":
        up = ind.bb_up[i]
        base = None if up is None else closes[i] > up
    elif sig == "donchian_breakout":
        up = ind.dc_up[i]
        base = None if up is None else closes[i] > up
    elif sig == "momentum":
        lb = spec.momentum_lookback_days
        base = None if i < lb else (closes[i] / closes[i - lb] - 1.0) * 100.0 >= spec.momentum_threshold_pct
    else:
        base = None

    # Volume-confirmation overlay: only stay/get long when participation backs
    # the move. Undefined volume ratio (warm-up) blocks the entry.
    if base and spec.require_volume_confirm:
        vr = ind.vol_r[i]
        if vr is None or vr < spec.volume_confirm_ratio:
            return False
    return base


def _exit_triggered(spec: TechnicalSpec, i: int, closes: list[float], ind: _Ind) -> bool:
    ex = spec.exit_signal
    if ex == "sma_reverse":
        f, s = ind.sma_f[i], ind.sma_s[i]
        return f is not None and s is not None and f < s
    if ex == "macd_reverse":
        line, signal = ind.macd_l[i], ind.macd_s[i]
        return line is not None and signal is not None and line < signal
    if ex == "rsi_overbought":
        r = ind.rsi[i]
        return r is not None and r >= spec.rsi_overbought
    if ex == "bollinger_revert":
        mid = ind.bb_mid[i]
        return mid is not None and closes[i] < mid
    if ex == "donchian_stop":
        lo = ind.dc_lo[i]
        return lo is not None and closes[i] < lo
    # "hold" and "time_exit" are handled by the position loop / desired-long flip
    return False


def run_backtest(
    prices: list[PricePoint],
    spec: TechnicalSpec,
    *,
    start: date,
    transaction_cost_bps: float = 10.0,
    market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    window = [p for p in prices if p.date >= start]
    if len(window) < 2:
        raise RuntimeError("insufficient price history in the backtest window")

    closes = [p.close for p in window]
    opens = [p.open for p in window]
    highs = [p.high for p in window]
    lows = [p.low for p in window]
    volumes = [p.volume for p in window]
    n = len(window)

    macd_l, macd_s, _ = macd(closes, spec.macd_fast, spec.macd_slow, spec.macd_signal)
    bb_mid, bb_up, bb_lo, _, _ = bollinger(closes, spec.bollinger_period, spec.bollinger_k)
    dc_up, dc_lo = donchian(highs, lows, spec.donchian_period)
    ind = _Ind(
        sma_f=sma(closes, spec.sma_fast),
        sma_s=sma(closes, spec.sma_slow),
        rsi=rsi_series(closes, spec.rsi_period),
        macd_l=macd_l,
        macd_s=macd_s,
        bb_mid=bb_mid,
        bb_up=bb_up,
        bb_lo=bb_lo,
        dc_up=dc_up,
        dc_lo=dc_lo,
        vol_r=volume_ratio(volumes, spec.volume_fast, spec.volume_slow),
    )
    cost = transaction_cost_bps / 10_000.0

    cash, equity = 1.0, 1.0           # strategy portfolio, starts at $1
    position = 0.0                    # shares held (in $1-normalised units)
    entry_price: float | None = None
    entry_idx: int | None = None
    trades: list[Trade] = []
    equity_curve: list[EquityPoint] = []
    days_in_market = 0

    # Benchmark obeys the SAME execution rule as strategies: it can only buy at
    # the first actionable open (next bar after the window start), not the
    # window-start close. Anchoring both at opens[1] makes buy_and_hold ≡
    # benchmark (to within transaction cost).
    bench_entry = opens[1]

    # Market (SPY) benchmark, aligned to the window dates, anchored at the same
    # first-actionable bar. Carry-forward on the rare missing date. None if absent.
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0

    for i in range(n):
        # ---- mark-to-market at today's close ----
        if position > 0:
            equity = position * closes[i]
            days_in_market += 1
        else:
            equity = cash

        # ---- decide action on today's close, execute at tomorrow's open ----
        can_execute = i + 1 < n
        exec_price = opens[i + 1] if can_execute else None

        if position > 0:
            assert entry_price is not None and entry_idx is not None
            exit_reason = ""
            fill_price: float | None = None
            fill_date = window[i].date
            # 1) intrabar risk overlay — fills at the trigger level on day i
            if spec.stop_loss_pct > 0:
                stop = entry_price * (1 - spec.stop_loss_pct / 100.0)
                if lows[i] <= stop:
                    exit_reason, fill_price = "stop_loss", min(opens[i], stop)
            if not exit_reason and spec.take_profit_pct > 0:
                tp = entry_price * (1 + spec.take_profit_pct / 100.0)
                if highs[i] >= tp:
                    exit_reason, fill_price = "take_profit", max(opens[i], tp)
            # 2) signal / time exits — decided on close i, filled at open i+1
            if not exit_reason and can_execute:
                if spec.exit_signal == "time_exit" and i - entry_idx >= spec.time_exit_days:
                    exit_reason = "time_exit"
                elif _exit_triggered(spec, i, closes, ind):
                    exit_reason = "signal"
                elif _wants_to_be_long(spec, i, closes, ind) is False:
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
            want = _wants_to_be_long(spec, i, closes, ind)
            if want:
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

        equity_curve.append(
            EquityPoint(
                date=window[i].date,
                strategy=round(equity, 6),
                # flat at 1.0 on bar 0 (not yet actionable), then hold from opens[1]
                benchmark=1.0 if i == 0 else round(closes[i] / bench_entry, 6),
                market=market_val,
            )
        )

    # close any still-open position at the last close for reporting
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


def _metrics(curve: list[EquityPoint], trades: list[Trade], closes: list[float],
             days_in_market: int, cost_bps: float) -> BacktestMetrics:
    n = len(curve)
    final = curve[-1].strategy
    total_ret = (final - 1.0) * 100.0
    # derive from the curve so it always matches the (opens[1]-anchored) benchmark
    bench_ret = (curve[-1].benchmark - 1.0) * 100.0
    days = (curve[-1].date - curve[0].date).days or 1
    cagr = ((final) ** (365.0 / days) - 1.0) * 100.0 if final > 0 else -100.0

    # daily strategy returns → annualised Sharpe (rf=0)
    rets = [curve[i].strategy / curve[i - 1].strategy - 1.0
            for i in range(1, n) if curve[i - 1].strategy > 0]
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        sd = math.sqrt(var)
        sharpe = (mean / sd * math.sqrt(_TRADING_DAYS)) if sd > 0 else 0.0
    else:
        sharpe = 0.0

    peak, max_dd = curve[0].strategy, 0.0
    for pt in curve:
        peak = max(peak, pt.strategy)
        if peak > 0:
            max_dd = min(max_dd, pt.strategy / peak - 1.0)

    closed = [t for t in trades if t.return_pct is not None]
    wins = [t for t in closed if (t.return_pct or 0) > 0]
    win_rate = (len(wins) / len(closed) * 100.0) if closed else 0.0

    # Entry-aligned benchmark: hold from the first entry price to the last close.
    bench_from_entry = excess_vs_entry = None
    if trades and trades[0].entry_price:
        bench_from_entry = (closes[-1] / trades[0].entry_price - 1.0) * 100.0
        excess_vs_entry = round(total_ret - bench_from_entry, 2)
        bench_from_entry = round(bench_from_entry, 2)

    # Market (S&P 500) benchmark + alpha vs market, derived from the curve.
    market_ret = market_excess = None
    if curve[-1].market is not None:
        market_ret = round((curve[-1].market - 1.0) * 100.0, 2)
        market_excess = round(total_ret - market_ret, 2)

    return BacktestMetrics(
        total_return_pct=round(total_ret, 2),
        benchmark_return_pct=round(bench_ret, 2),
        excess_return_pct=round(total_ret - bench_ret, 2),
        benchmark_from_entry_pct=bench_from_entry,
        excess_vs_entry_pct=excess_vs_entry,
        market_return_pct=market_ret,
        excess_vs_market_pct=market_excess,
        cagr_pct=round(cagr, 2),
        sharpe=round(sharpe, 2),
        max_drawdown_pct=round(max_dd * 100.0, 2),
        win_rate_pct=round(win_rate, 1),
        n_trades=len(trades),
        exposure_pct=round(days_in_market / n * 100.0, 1) if n else 0.0,
        days=days,
        transaction_cost_bps=cost_bps,
    )
