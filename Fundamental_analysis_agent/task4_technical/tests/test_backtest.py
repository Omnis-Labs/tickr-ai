"""Correctness tests for the technical backtest engine.

The first group ports Task 3's suite to prove the copied position loop preserved
the no-lookahead, window-boundary, cost, stop-loss and benchmark properties. The
second group exercises the new technical signals (MACD, Donchian, Bollinger) and
the volume-confirmation overlay.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task4_technical.pipeline.backtest import run_backtest
from task4_technical.schemas import PricePoint, TechnicalSpec


def _series(closes: list[float], start: date = date(2020, 1, 1),
            volumes: list[float] | None = None) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(
            date=start + timedelta(days=i),
            open=o, high=max(o, c), low=min(o, c), close=c,
            volume=(volumes[i] if volumes else 1_000.0),
        ))
    return pts


# --- ported Task 3 properties (the copied loop must still satisfy these) -----

def test_buy_and_hold_tracks_benchmark_minus_costs():
    prices = _series([100, 101, 102, 103, 104, 105])
    spec = TechnicalSpec(entry_signal="buy_and_hold", exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.benchmark_return_pct == pytest.approx(5.0, abs=0.01)
    assert r.metrics.total_return_pct < r.metrics.benchmark_return_pct
    assert r.metrics.total_return_pct > 0


def test_no_lookahead_on_final_bar():
    prices = _series([100, 100, 100, 100, 130])  # momentum only fires at the end
    spec = TechnicalSpec(entry_signal="momentum", momentum_lookback_days=1,
                         momentum_threshold_pct=5.0, exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)
    assert r.metrics.n_trades == 0


def test_window_boundary_excludes_earlier_bars():
    prices = _series([10, 20, 40, 80, 160, 320])
    boundary = prices[3].date
    r = run_backtest(prices, TechnicalSpec(entry_signal="buy_and_hold"), start=boundary)
    assert r.start_date == boundary
    assert r.metrics.benchmark_return_pct == pytest.approx(300.0, abs=0.01)


def test_stop_loss_caps_the_loss():
    prices = _series([100, 110, 99, 80, 60, 50])
    spec = TechnicalSpec(entry_signal="buy_and_hold", exit_signal="hold", stop_loss_pct=10.0)
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.n_trades >= 1
    assert r.trades[0].exit_reason == "stop_loss"
    assert r.metrics.total_return_pct > r.metrics.benchmark_return_pct
    assert r.metrics.total_return_pct > -50


def test_market_benchmark_and_alpha():
    stock = _series([100, 110, 121, 133])
    market = _series([100, 102, 104, 106])
    r = run_backtest(stock, TechnicalSpec(entry_signal="buy_and_hold"),
                     start=stock[0].date, market_prices=market)
    assert r.metrics.market_return_pct == pytest.approx(6.0, abs=0.1)
    assert r.metrics.excess_vs_market_pct == pytest.approx(
        r.metrics.total_return_pct - r.metrics.market_return_pct, abs=0.01)
    assert r.equity_curve[0].market == 1.0


def test_insufficient_history_raises():
    prices = _series([100])
    with pytest.raises(RuntimeError):
        run_backtest(prices, TechnicalSpec(entry_signal="buy_and_hold"), start=prices[0].date)


# --- new technical signals ---------------------------------------------------

def test_macd_cross_generates_trades():
    # steady rise then steady fall → at least one MACD cross up and back down
    closes = [100 + i for i in range(40)] + [140 - i for i in range(40)]
    prices = _series(closes)
    spec = TechnicalSpec(entry_signal="macd_cross", exit_signal="macd_reverse")
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.n_trades >= 1


def test_donchian_breakout_enters_on_new_high():
    # 25 flat bars, then a clean break to new highs
    closes = [50.0] * 25 + [51, 52, 53, 54, 55, 56, 57, 58]
    prices = _series(closes)
    spec = TechnicalSpec(entry_signal="donchian_breakout", donchian_period=20, exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.n_trades >= 1


def test_bollinger_breakout_enters_above_band():
    closes = [50.0] * 25 + [60, 61, 62, 63, 64]   # sharp break above the upper band
    prices = _series(closes)
    spec = TechnicalSpec(entry_signal="bollinger_breakout", bollinger_period=20,
                         bollinger_k=2.0, exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.n_trades >= 1


def test_volume_confirm_blocks_low_volume_entry():
    # identical price path; the donchian breakout fires, but flat volume fails the
    # 1.5× confirmation, so the overlay blocks the entry entirely.
    closes = [50.0] * 25 + [51, 52, 53, 54, 55, 56, 57, 58]
    flat_vol = [1_000.0] * len(closes)
    prices = _series(closes, volumes=flat_vol)

    base = TechnicalSpec(entry_signal="donchian_breakout", donchian_period=20, exit_signal="hold")
    r_base = run_backtest(prices, base, start=prices[0].date)
    assert r_base.metrics.n_trades >= 1        # enters without the overlay

    gated = TechnicalSpec(entry_signal="donchian_breakout", donchian_period=20, exit_signal="hold",
                          require_volume_confirm=True, volume_fast=20, volume_slow=50,
                          volume_confirm_ratio=1.5)
    r_gated = run_backtest(prices, gated, start=prices[0].date)
    assert r_gated.metrics.n_trades == 0       # flat volume → blocked
