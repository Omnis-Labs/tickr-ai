"""Tests for the price-anomaly agent. No network."""

from __future__ import annotations

from datetime import date, timedelta

from task19_anomaly.pipeline.signals import anomaly_readings, make_want_long
from task19_anomaly.schemas import AnomalySpec, PricePoint


def _series(closes, start=date(2021, 1, 1)):
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o, high=max(o, c), low=min(o, c), close=c, volume=1e6))
    return pts


def test_near_52w_high_long_only_near_high():
    # ramp up then pull back 20%
    closes = [100 + i for i in range(260)] + [359 - 3 * i for i in range(30)]
    prices = _series(closes)
    wl = make_want_long(AnomalySpec(entry_signal="near_52w_high", high_threshold_pct=5.0), prices)
    assert wl(prices[259].date)          # at the high → long
    assert not wl(prices[-1].date)       # ~25% below high → flat


def test_avoid_max_lottery_steps_aside_after_spike():
    closes = [100.0] * 30
    closes += [130.0]                    # +30% spike
    closes += [131.0] * 10               # drift after
    prices = _series(closes)
    wl = make_want_long(AnomalySpec(entry_signal="avoid_max_lottery", max_daily_threshold_pct=10.0, max_window_days=21), prices)
    assert wl(prices[20].date)           # calm before spike → long
    assert not wl(prices[31].date)       # just after the +30% spike → flat


def test_tax_loss_reversal_only_dec_jan_losers():
    # steadily-down loser, long enough that Dec/July both have 11m of prior history
    closes = [300 - 0.3 * i for i in range(600)]
    prices = _series(closes, start=date(2023, 1, 1))
    wl = make_want_long(AnomalySpec(entry_signal="tax_loss_reversal"), prices)
    dec = next(i for i, p in enumerate(prices) if p.date.month == 12 and i >= 231)
    jul = next(i for i, p in enumerate(prices) if p.date.month == 7 and i >= 231)
    assert wl(prices[dec].date)        # December + YTD loser → long
    assert not wl(prices[jul].date)    # July → outside the Dec/Jan window


def test_readings_present():
    r = anomaly_readings(_series([100 + (i % 20) for i in range(300)]))
    assert "anomaly_regime" in r and "pct_below_52w_high" in r and "recent_max_daily_pct" in r
