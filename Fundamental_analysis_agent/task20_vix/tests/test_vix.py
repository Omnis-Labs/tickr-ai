"""Tests for the VIX-regime gate agent. No network."""

from __future__ import annotations

from datetime import date

from task20_vix.pipeline.signals import build_vix_map, make_want_long, vix_readings
from task20_vix.schemas import PricePoint, VixSpec


def _p(d, c):
    return PricePoint(date=d, open=c, high=c, low=c, close=c, volume=0.0)


def test_build_vix_map_ratio():
    vix = [_p(date(2024, 1, 2), 20.0), _p(date(2024, 1, 3), 30.0)]
    vix3m = [_p(date(2024, 1, 2), 25.0), _p(date(2024, 1, 3), 25.0)]
    m = build_vix_map(vix, vix3m)
    assert m[date(2024, 1, 2)][2] == 0.8        # 20/25 contango
    assert m[date(2024, 1, 3)][2] == 1.2        # 30/25 inverted


def test_term_gate_flat_when_inverted():
    vix = [_p(date(2024, 1, 2), 20.0), _p(date(2024, 1, 3), 30.0)]
    vix3m = [_p(date(2024, 1, 2), 25.0), _p(date(2024, 1, 3), 25.0)]
    m = build_vix_map(vix, vix3m)
    wl = make_want_long(VixSpec(entry_signal="vix_term_gate", term_threshold=1.0), m)
    assert wl(date(2024, 1, 2))         # ratio 0.8 < 1 → calm → long
    assert not wl(date(2024, 1, 3))     # ratio 1.2 >= 1 → fear → flat


def test_level_gate():
    vix = [_p(date(2024, 1, 2), 18.0), _p(date(2024, 1, 3), 40.0)]
    vix3m = [_p(date(2024, 1, 2), 18.0), _p(date(2024, 1, 3), 40.0)]
    m = build_vix_map(vix, vix3m)
    wl = make_want_long(VixSpec(entry_signal="vix_level_gate", level_threshold=25.0), m)
    assert wl(date(2024, 1, 2)) and not wl(date(2024, 1, 3))


def test_readings_regime():
    m = build_vix_map([_p(date(2024, 1, 2), 30.0)], [_p(date(2024, 1, 2), 25.0)])
    r = vix_readings(m, date(2024, 1, 2))
    assert r["vix_regime"] == "fear_inverted" and r["term_ratio"] == 1.2
