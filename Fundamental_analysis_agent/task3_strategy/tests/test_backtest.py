"""Correctness tests for the filing-date-aligned backtest engine.

The properties that matter for an honest backtest: no lookahead, the filing-date
boundary is respected, costs are charged, and the benchmark is computed over the
same window.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task3_strategy.pipeline.backtest import run_backtest
from task3_strategy.schemas import PricePoint, StrategySpec


def _series(closes: list[float], start: date = date(2020, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(
            date=start + timedelta(days=i),
            open=o, high=max(o, c) * 1.0, low=min(o, c) * 1.0, close=c, volume=1_000.0,
        ))
    return pts


def test_buy_and_hold_tracks_benchmark_minus_costs():
    prices = _series([100, 101, 102, 103, 104, 105])
    spec = StrategySpec(entry_signal="buy_and_hold", exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date, transaction_cost_bps=10.0)
    # benchmark over the window:
    assert r.metrics.benchmark_return_pct == pytest.approx(5.0, abs=0.01)
    # strategy buys at bar-1 open and is charged ~2 sides of cost → slightly below
    assert r.metrics.total_return_pct < r.metrics.benchmark_return_pct
    assert r.metrics.total_return_pct > 0


def test_no_lookahead_on_final_bar():
    """A signal that only turns true on the very last close cannot be traded —
    there is no next-bar open to fill against."""
    prices = _series([100, 100, 100, 100, 130])  # momentum only fires at the end
    spec = StrategySpec(entry_signal="momentum", momentum_lookback_days=1,
                        momentum_threshold_pct=5.0, exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date)
    # the +30% jump is on the last bar; no entry should capture it
    assert r.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)
    assert r.metrics.n_trades == 0


def test_filing_date_boundary_excludes_earlier_bars():
    prices = _series([10, 20, 40, 80, 160, 320])  # huge early run-up
    boundary = prices[3].date  # only the last 3 bars are in-window
    spec = StrategySpec(entry_signal="buy_and_hold")
    r = run_backtest(prices, spec, start=boundary)
    assert r.start_date == boundary
    # benchmark from 80 → 320 = +300%, NOT from 10
    assert r.metrics.benchmark_return_pct == pytest.approx(300.0, abs=0.01)


def test_stop_loss_caps_the_loss():
    # rises then crashes; a 10% stop should cut the loss well above the -50% nadir
    prices = _series([100, 110, 99, 80, 60, 50])
    spec = StrategySpec(entry_signal="buy_and_hold", exit_signal="hold", stop_loss_pct=10.0)
    r = run_backtest(prices, spec, start=prices[0].date)
    # the first exit is the stop firing; buy_and_hold may re-enter next bar, so
    # n_trades can be >1, but the stop must materially beat holding to the bottom
    assert r.metrics.n_trades >= 1
    assert r.trades[0].exit_reason == "stop_loss"
    assert r.metrics.total_return_pct > r.metrics.benchmark_return_pct  # stop helped
    assert r.metrics.total_return_pct > -50  # not held to the -50% bottom


def test_sma_cross_generates_trades():
    closes = [10] * 30 + [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] + [19, 18, 17, 16, 15, 14, 13, 12, 11, 10]
    prices = _series(closes)
    spec = StrategySpec(entry_signal="sma_cross", sma_fast=3, sma_slow=10, exit_signal="sma_reverse")
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.n_trades >= 1


def test_entry_aligned_benchmark_isolates_warmup_drag():
    """A momentum strategy that can only enter after its lookback warm-up should
    trail the full-window benchmark (missed the early rise) but ~match the
    entry-aligned benchmark (once in, it just held)."""
    closes = [100] * 5 + [100 + 8 * i for i in range(1, 26)]  # flat, then steady rise
    prices = _series(closes)
    spec = StrategySpec(entry_signal="momentum", momentum_lookback_days=5,
                        momentum_threshold_pct=1.0, exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date)
    m = r.metrics
    assert m.n_trades >= 1
    assert m.benchmark_from_entry_pct is not None
    # full-window benchmark captures the whole rise; entry-aligned starts later → smaller
    assert m.benchmark_return_pct > m.benchmark_from_entry_pct
    # once invested the strategy just holds → excess vs its own entry is ~0 (only cost)
    assert abs(m.excess_vs_entry_pct) < 1.0


def test_buy_and_hold_equals_benchmark_despite_day1_gap():
    """buy_and_hold must ≈ benchmark even when day 1 gaps up (post-earnings):
    both are anchored at the first actionable open, so the gap penalises
    neither. Regression for the −6.48% artifact where the benchmark started at
    the filing-date close but the strategy could only buy the next open."""
    # day 0 close 100, then day 1 GAPS to open 110 (+10%), holds up
    pts = [
        PricePoint(date=date(2020, 1, 1), open=100, high=100, low=100, close=100, volume=1),
        PricePoint(date=date(2020, 1, 2), open=110, high=112, low=109, close=111, volume=1),
        PricePoint(date=date(2020, 1, 3), open=111, high=120, low=110, close=118, volume=1),
        PricePoint(date=date(2020, 1, 4), open=118, high=125, low=117, close=123, volume=1),
    ]
    r = run_backtest(pts, StrategySpec(entry_signal="buy_and_hold"), start=pts[0].date,
                     transaction_cost_bps=10.0)
    # both anchored at opens[1]=110 → excess is just the round-trip cost, ~0
    assert abs(r.metrics.excess_return_pct) < 0.5
    # and the benchmark reflects the post-gap entry (110→123), not 100→123
    assert r.metrics.benchmark_return_pct == pytest.approx((123 / 110 - 1) * 100, abs=0.1)


def test_entry_aligned_benchmark_none_when_no_trades():
    prices = _series([100, 100, 100, 100, 130])
    spec = StrategySpec(entry_signal="momentum", momentum_lookback_days=1, momentum_threshold_pct=5.0)
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.n_trades == 0
    assert r.metrics.benchmark_from_entry_pct is None
    assert r.metrics.excess_vs_entry_pct is None


def test_market_benchmark_and_alpha():
    stock = _series([100, 110, 121, 133])
    market = _series([100, 102, 104, 106])  # same dates, +6% over the window
    r = run_backtest(stock, StrategySpec(entry_signal="buy_and_hold"),
                     start=stock[0].date, market_prices=market)
    # market anchored at opens[1]==close[0]==100 → 106/100−1 = +6%
    assert r.metrics.market_return_pct == pytest.approx(6.0, abs=0.1)
    # alpha vs market = strategy total − market return
    assert r.metrics.excess_vs_market_pct == pytest.approx(
        r.metrics.total_return_pct - r.metrics.market_return_pct, abs=0.01)
    assert r.equity_curve[-1].market is not None
    assert r.equity_curve[0].market == 1.0  # flat on bar 0


def test_market_benchmark_none_without_data():
    stock = _series([100, 101, 102, 103])
    r = run_backtest(stock, StrategySpec(entry_signal="buy_and_hold"), start=stock[0].date)
    assert r.metrics.market_return_pct is None
    assert r.metrics.excess_vs_market_pct is None
    assert r.equity_curve[-1].market is None


def test_insufficient_history_raises():
    prices = _series([100])
    with pytest.raises(RuntimeError):
        run_backtest(prices, StrategySpec(entry_signal="buy_and_hold"), start=prices[0].date)
