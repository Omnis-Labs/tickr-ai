"""Filing-date-aligned backtest engine. Pure Python, deterministic.

Correctness properties (this is the whole point of the feature):

  * **Lookahead-free.** The backtest window starts at `filing_available_date`
    (the 10-K filing date). A signal is computed from closes up to and
    including day *t* and executed at the **open of day t+1** — never the same
    bar, never a future bar.
  * **Costs modelled.** A transaction cost (default 10 bps) is charged on every
    entry and every exit.
  * **Split/dividend adjusted** prices come from the ingest layer.
  * **Honest benchmark.** Every run is reported against buy-and-hold of the same
    stock over the identical window, so a strategy that merely tracks the stock
    cannot look clever.

Long-only / fully-invested-or-flat. The LLM's 10-K thesis selects the strategy
and parameters; this engine only executes them.
"""

from __future__ import annotations

import math
from datetime import date

from task3_strategy.schemas import (
    BacktestMetrics,
    BacktestResult,
    EquityPoint,
    PricePoint,
    StrategySpec,
    Trade,
)

_TRADING_DAYS = 252


# --- indicators (each returns a list aligned to `closes`, None where undefined)

def _sma(closes: list[float], window: int) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if window <= 0:
        return out
    run = 0.0
    for i, c in enumerate(closes):
        run += c
        if i >= window:
            run -= closes[i - window]
        if i >= window - 1:
            out[i] = run / window
    return out


def _rsi(closes: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if period <= 0 or len(closes) <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        ch = closes[i] - closes[i - 1]
        gains += max(ch, 0.0)
        losses += max(-ch, 0.0)
    avg_gain, avg_loss = gains / period, losses / period
    out[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, len(closes)):
        ch = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(ch, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-ch, 0.0)) / period
        out[i] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    return out


def _wants_to_be_long(spec: StrategySpec, i: int, closes: list[float],
                      sma_f: list[float | None], sma_s: list[float | None],
                      rsi: list[float | None]) -> bool | None:
    """Desired position at the *close* of bar i (acted on at open of i+1).
    Returns None when the signal is undefined (warm-up) → treat as flat."""
    sig = spec.entry_signal
    if sig == "buy_and_hold":
        return True
    if sig == "sma_cross":
        f, s = sma_f[i], sma_s[i]
        if f is None or s is None:
            return None
        return f > s
    if sig == "momentum":
        lb = spec.momentum_lookback_days
        if i < lb:
            return None
        ret = (closes[i] / closes[i - lb] - 1.0) * 100.0
        return ret >= spec.momentum_threshold_pct
    if sig == "rsi_oversold":
        r = rsi[i]
        if r is None:
            return None
        # enter oversold; the exit_signal handles leaving
        return r <= spec.rsi_oversold
    return None


def _exit_triggered(spec: StrategySpec, i: int, closes: list[float],
                    sma_f: list[float | None], sma_s: list[float | None],
                    rsi: list[float | None]) -> bool:
    ex = spec.exit_signal
    if ex == "sma_reverse":
        f, s = sma_f[i], sma_s[i]
        return f is not None and s is not None and f < s
    if ex == "rsi_overbought":
        r = rsi[i]
        return r is not None and r >= spec.rsi_overbought
    # "hold" and "time_exit" are handled by the position loop / desired-long flip
    return False


def run_backtest(
    prices: list[PricePoint],
    spec: StrategySpec,
    *,
    start: date,
    transaction_cost_bps: float = 10.0,
) -> BacktestResult:
    window = [p for p in prices if p.date >= start]
    if len(window) < 2:
        raise RuntimeError("insufficient price history after filing date for a backtest")

    closes = [p.close for p in window]
    opens = [p.open for p in window]
    highs = [p.high for p in window]
    lows = [p.low for p in window]
    n = len(window)

    sma_f = _sma(closes, spec.sma_fast)
    sma_s = _sma(closes, spec.sma_slow)
    rsi = _rsi(closes, spec.rsi_period)
    cost = transaction_cost_bps / 10_000.0

    cash, equity = 1.0, 1.0           # strategy portfolio, starts at $1
    position = 0.0                    # shares held (in $1-normalised units)
    entry_price: float | None = None
    entry_idx: int | None = None
    trades: list[Trade] = []
    equity_curve: list[EquityPoint] = []
    days_in_market = 0

    # Benchmark obeys the SAME execution rule as strategies: it can only buy at
    # the first actionable open (next bar after the filing date), not the
    # filing-date close. Otherwise a post-earnings gap on day 1 — which the
    # strategy structurally cannot capture — would make even buy_and_hold look
    # like it "lost" to the benchmark. Anchoring both at opens[1] makes
    # buy_and_hold ≡ benchmark (to within transaction cost).
    bench_entry = opens[1]

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
                elif _exit_triggered(spec, i, closes, sma_f, sma_s, rsi):
                    exit_reason = "signal"
                elif _wants_to_be_long(spec, i, closes, sma_f, sma_s, rsi) is False:
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
            want = _wants_to_be_long(spec, i, closes, sma_f, sma_s, rsi)
            if want:
                fill = exec_price * (1 + cost)
                position = cash / fill
                entry_price, entry_idx = exec_price, i + 1
                trades.append(Trade(entry_date=window[i + 1].date, entry_price=round(exec_price, 4)))
                cash = 0.0

        equity_curve.append(
            EquityPoint(
                date=window[i].date,
                strategy=round(equity, 6),
                # flat at 1.0 on bar 0 (not yet actionable), then hold from opens[1]
                benchmark=1.0 if i == 0 else round(closes[i] / bench_entry, 6),
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

    return BacktestMetrics(
        total_return_pct=round(total_ret, 2),
        benchmark_return_pct=round(bench_ret, 2),
        excess_return_pct=round(total_ret - bench_ret, 2),
        benchmark_from_entry_pct=bench_from_entry,
        excess_vs_entry_pct=excess_vs_entry,
        cagr_pct=round(cagr, 2),
        sharpe=round(sharpe, 2),
        max_drawdown_pct=round(max_dd * 100.0, 2),
        win_rate_pct=round(win_rate, 1),
        n_trades=len(trades),
        exposure_pct=round(days_in_market / n * 100.0, 1) if n else 0.0,
        days=days,
        transaction_cost_bps=cost_bps,
    )
