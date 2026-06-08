"""Tests for the 八字 placebo engine. No network (pure computation)."""

from __future__ import annotations

from datetime import date

from task27_bazi.pipeline import bazi as B
from task27_bazi.pipeline.signals import build_chart
from task27_bazi.schemas import BaziSpec


def test_jdn_anchor():
    assert B._jdn(2000, 1, 1) == 2451545


def test_day_pillar_anchor_jiazi():
    # the verifiable anchor: 2000-01-07 is a 甲子 day
    s, b = B.day_pillar(date(2000, 1, 7))
    assert B.STEMS[s] == "甲" and B.BRANCHES[b] == "子"


def test_year_pillar_anchor_and_lichun_boundary():
    # 1984 (after 立春) = 甲子年
    s, b = B.year_pillar(date(1984, 6, 1))
    assert B.STEMS[s] + B.BRANCHES[b] == "甲子"
    # before 立春 rolls back a year: 1984-01-15 belongs to 1983 = 癸亥
    s2, b2 = B.year_pillar(date(1984, 1, 15))
    assert B.STEMS[s2] + B.BRANCHES[b2] == "癸亥"


def test_aapl_natal_chart_known():
    p = B.four_pillars(date(1980, 12, 12))
    assert p["year"]["gz"] == "庚申"      # 1980 = 庚申年
    assert p["day"]["gz"] == "己未"       # day master 己 (土)
    assert p["hour"]["branch"] == "巳"    # 09:30 → 巳時


def test_strength_and_favourable_consistent():
    p = B.four_pillars(date(1980, 12, 12))
    fav = B.strength_and_favourable(p)
    assert fav["dm_elem"] == "土"
    # favourable set is non-empty and excludes contradictory membership
    assert fav["favourable"] and all(e in ("木", "火", "土", "金", "水") for e in fav["favourable"])
    # strong DM → wants drain/control (not 印/比); weak → wants support
    if fav["strong"]:
        assert fav["dm_elem"] not in fav["favourable"]
    else:
        assert fav["dm_elem"] in fav["favourable"]


def test_want_long_follows_favourable_year():
    chart, fav = build_chart(date(1999, 1, 22), data_limit=False)   # NVDA
    spec = BaziSpec(entry_signal="favorable_year")
    wl = B.make_want_long(spec, set(chart.favourable))
    for y in (2021, 2022, 2023, 2024):
        d = date(y, 6, 1)
        assert wl(d) == (B.liunian_elem(d) in set(chart.favourable))
    assert all(B.make_want_long(BaziSpec(entry_signal="buy_and_hold"), set())(date(y, 6, 1)) for y in (2022, 2023))


def test_build_chart_has_four_pillars():
    chart, _ = build_chart(date(1986, 3, 13), data_limit=False)   # MSFT
    assert len(chart.pillars) == 4 and chart.day_master and sum(chart.element_counts.values()) == 8
