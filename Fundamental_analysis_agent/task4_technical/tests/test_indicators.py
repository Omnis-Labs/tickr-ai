"""Correctness tests for the technical indicators.

The properties that matter: the new indicators compute the standard quantities,
Donchian uses the PRIOR window (a real breakout), and the as-of readings cannot
see future bars (the grounding the LLM gets is lookahead-free).
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task4_technical.pipeline.indicators import (
    bollinger,
    donchian,
    ema,
    indicator_readings_asof,
    macd,
    sma,
    volume_ratio,
)
from task4_technical.schemas import PricePoint


def _series(closes: list[float], start: date = date(2020, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(
            date=start + timedelta(days=i),
            open=o, high=max(o, c), low=min(o, c), close=c, volume=1_000.0,
        ))
    return pts


def test_ema_seeds_and_reacts_faster_than_sma():
    flat = [10.0] * 10
    assert ema(flat, 5)[-1] == 10.0           # EMA of a constant equals the constant
    step = [10.0] * 5 + [20.0] * 5
    # At the FIRST bar of the step up, EMA has already moved more than the SMA
    # (which still averages in the old regime). EMA reacts faster to the change.
    e = ema(step, 3)[5]
    s = sma(step, 3)[5]
    assert e is not None and s is not None
    assert e > s


def test_macd_sign_flips_on_trend_change():
    closes = [100 + i for i in range(40)] + [140 - i for i in range(40)]
    line, signal, _ = macd(closes, 12, 26, 9)
    # during the steady rise the line is above its signal
    assert line[39] is not None and signal[39] is not None
    assert line[39] > signal[39]
    # by the end of the steady fall it has crossed below
    assert line[-1] < signal[-1]


def test_bollinger_pctb_and_bandwidth_on_flat_then_break():
    flat = [50.0] * 25
    mid, up, lo, pctb, bw = bollinger(flat, 20, 2.0)
    assert abs(pctb[-1] - 0.5) < 1e-9          # flat series sits at the middle band
    assert bw[-1] == 0.0                        # zero bandwidth when σ = 0
    # a close above the recent mean pushes %b above 0.5
    rising = [50.0] * 20 + [55.0]
    _, _, _, pctb2, _ = bollinger(rising, 20, 2.0)
    assert pctb2[-1] > 0.5


def test_donchian_uses_prior_window():
    highs = [10, 11, 12, 13, 14, 20]
    lows = [9, 10, 11, 12, 13, 19]
    up, _ = donchian(highs, lows, 5)
    # at i=5 the prior-5 window is highs[0:5] = max 14; the current bar (20) is
    # EXCLUDED, so a close of 20 genuinely breaks the channel.
    assert up[5] == 14
    assert highs[5] > up[5]                     # real breakout, not a self-touch


def test_volume_ratio_ramp():
    vols = [100.0] * 10 + [300.0] * 10
    vr = volume_ratio(vols, 5, 10)
    # At i=14 the fast (5) window is all 300 while the slow (10) window still
    # straddles the ramp (five 100s + five 300s = 200 avg) → ratio 1.5 > 1.
    assert vr[14] is not None and vr[14] > 1.0
    # by the end both windows are fully in the high-volume regime → ratio ≈ 1
    assert vr[-1] == pytest.approx(1.0)


def test_readings_asof_excludes_future():
    prices = _series([100 + i for i in range(260)])
    as_of = prices[200].date
    before = indicator_readings_asof(prices, as_of)
    # mutate every bar AFTER the decision date
    for p in prices[201:]:
        p.close = p.high = p.low = p.open = 9_999.0
    after = indicator_readings_asof(prices, as_of)
    assert before == after                      # future bars must not change as-of readings
