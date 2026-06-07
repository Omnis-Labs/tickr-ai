"""Correctness tests for the seasonality agent — calendar rules + backtest. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task12_seasonality.pipeline.backtest import run_seasonal_backtest
from task12_seasonality.pipeline.signals import seasonal_readings, wants_long
from task12_seasonality.schemas import PricePoint, SeasonalSpec


def _daily_series(n: int, start: date = date(2020, 1, 1), step: float = 0.0005) -> list[PricePoint]:
    pts, c = [], 100.0
    for i in range(n):
        o = c
        c = c * (1 + step)
        pts.append(PricePoint(date=start + timedelta(days=i), open=o, high=max(o, c),
                              low=min(o, c), close=c, volume=1_000.0))
    return pts


def test_wants_long_calendar_rules():
    prices = _daily_series(40, start=date(2021, 6, 1))  # June
    spec_may = SeasonalSpec(entry_signal="sell_in_may")
    assert not wants_long(prices, 0, spec_may)          # June → flat
    spec_bh = SeasonalSpec(entry_signal="buy_and_hold")
    assert wants_long(prices, 0, spec_bh)
    spec_best = SeasonalSpec(entry_signal="best_months", months=[6])
    assert wants_long(prices, 0, spec_best)             # June in chosen months
    spec_best2 = SeasonalSpec(entry_signal="best_months", months=[1])
    assert not wants_long(prices, 0, spec_best2)


def test_sell_in_may_is_long_in_winter():
    prices = _daily_series(40, start=date(2021, 12, 1))  # December
    assert wants_long(prices, 0, SeasonalSpec(entry_signal="sell_in_may"))


def test_seasonal_readings_have_month_split():
    prices = _daily_series(800)  # ~2+ years of calendar days
    r = seasonal_readings(prices)
    assert "best_months" in r and "nov_apr_ann_pct" in r and "turn_of_month_ann_pct" in r
    assert r["years_of_history"] > 1


def test_best_months_backtest_only_trades_in_chosen_month():
    prices = _daily_series(420, start=date(2021, 1, 1))
    spec = SeasonalSpec(entry_signal="best_months", months=[3])  # only March
    r = run_seasonal_backtest(prices, spec, start=prices[0].date, transaction_cost_bps=10.0)
    # entered/exited around March each year → some trades, partial exposure
    assert r.metrics.n_trades >= 1
    assert 0 < r.metrics.exposure_pct < 50


def test_buy_and_hold_tracks_benchmark():
    prices = _daily_series(300)
    r = run_seasonal_backtest(prices, SeasonalSpec(entry_signal="buy_and_hold"),
                              start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.total_return_pct > 0
    assert r.metrics.exposure_pct > 90
