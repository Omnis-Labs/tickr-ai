"""Tests for the 七政四餘 placebo engine. No network (ephem offline)."""

from __future__ import annotations

from datetime import date

from task30_qizheng.pipeline import qizheng as Q
from task30_qizheng.schemas import QizhengSpec


def test_four_remainders_node_near_125_at_j2000():
    fr = Q.four_remainders(date(2000, 1, 1))
    assert 120 < fr["羅睺"] < 130
    assert abs(((fr["計都"] - fr["羅睺"]) % 360) - 180) < 1e-6
    assert all(0 <= v < 360 for v in fr.values())


def test_chart_has_seven_plus_four():
    c = Q.chart_for(date(1999, 1, 22))
    assert len(c) == 11
    names = [n for n, _l, _s in c]
    assert names[:7] == ["日", "月", "水", "金", "火", "木", "土"]
    assert set(names[7:]) == {"羅睺", "計都", "月孛", "紫炁"}


def test_make_want_long_modes():
    dates = [date(2024, 6, 1), date(2025, 6, 1)]
    state = {dates[0]: {"benefic": True, "malefic": False}, dates[1]: {"benefic": False, "malefic": True}}
    wl_b = Q.make_want_long(QizhengSpec(entry_signal="benefic_transit"), state)
    wl_m = Q.make_want_long(QizhengSpec(entry_signal="avoid_malefic"), state)
    assert wl_b(dates[0]) and not wl_b(dates[1])
    assert wl_m(dates[0]) and not wl_m(dates[1])
    assert Q.make_want_long(QizhengSpec(entry_signal="buy_and_hold"), state)(dates[0])


def test_build_state_deterministic():
    d = [date(2024, 1, 2), date(2024, 6, 1)]
    assert Q.build_state(d, 0) == Q.build_state(d, 0)
