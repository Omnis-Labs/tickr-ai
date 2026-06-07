"""Tests for the volatility-regime agent. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task14_volatility.pipeline.backtest import run_vol_backtest, volatility_readings
from task14_volatility.schemas import PricePoint, VolSpec


def _series(daily: list[float], start: date = date(2021, 1, 1)) -> list[PricePoint]:
    """daily = list of close-to-close returns; flat intraday (open=prev close)."""
    pts, c = [], 100.0
    for i, r in enumerate(daily):
        o = c
        c = c * (1 + r)
        pts.append(PricePoint(date=start + timedelta(days=i), open=o, high=max(o, c), low=min(o, c), close=c, volume=1e6))
    return pts


def test_readings_have_regime_and_percentile():
    prices = _series([0.001] * 300)
    r = volatility_readings(prices)
    assert "vol_regime" in r and "current_vol_ann_pct" in r and "vol_percentile" in r


def test_calm_regime_flat_during_high_vol():
    # first half calm (tiny moves), second half stressed (big alternating moves)
    calm = [0.0008] * 150
    stressed = [0.05 if i % 2 == 0 else -0.05 for i in range(150)]
    prices = _series(calm + stressed)
    spec = VolSpec(entry_signal="calm_regime", vol_window=20, vol_threshold_pct=30.0)
    r = run_vol_backtest(prices, spec, start=prices[0].date, transaction_cost_bps=10.0)
    bh = run_vol_backtest(prices, VolSpec(entry_signal="buy_and_hold"), start=prices[0].date)
    # calm_regime should sit out the stressed second half → much lower exposure + drawdown
    assert r.metrics.exposure_pct < 80
    assert r.metrics.max_drawdown_pct >= bh.metrics.max_drawdown_pct  # less negative (smaller DD)


def test_buy_and_hold_full_exposure():
    prices = _series([0.001] * 300)
    r = run_vol_backtest(prices, VolSpec(entry_signal="buy_and_hold"), start=prices[0].date)
    assert r.metrics.exposure_pct > 95 and r.metrics.total_return_pct > 0
