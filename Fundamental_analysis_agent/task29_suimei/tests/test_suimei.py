"""Tests for the 四柱推命 placebo engine. No network (pure computation)."""

from __future__ import annotations

from datetime import date

from task29_suimei.pipeline import suimei as S
from task29_suimei.schemas import SuimeiSpec


def test_twelve_fortune_anchors():
    # 甲 帝旺在卯, 長生在亥; 丙 帝旺在午; 庚 帝旺在酉 (陽干順)
    assert S.twelve_fortune(0, 3) == "帝旺" and S.twelve_fortune(0, 11) == "長生"
    assert S.twelve_fortune(2, 6) == "帝旺" and S.twelve_fortune(6, 9) == "帝旺"
    # 乙 (陰干逆) 長生在午
    assert S.twelve_fortune(1, 6) == "長生"


def test_twelve_fortune_full_cycle_is_permutation():
    for stem in range(10):
        stages = [S.twelve_fortune(stem, b) for b in range(12)]
        assert sorted(stages) == sorted(S.TWELVE)   # each of the 12 stages exactly once


def test_tenchusatsu_pairs():
    # 甲子日 (旬0) → 戌亥; 甲戌日 (旬1) → 申酉; 甲寅日 (旬5) → 子丑
    assert S.tenchusatsu(0, 0) == (10, 11)
    assert S.tenchusatsu(0, 10) == (8, 9)
    assert S.tenchusatsu(0, 2) == (0, 1)


def test_build_chart_nvda():
    c = S.build_chart(date(1999, 1, 22))
    assert c["day_master"] == "甲" and c["tenchusatsu"] == "申酉"
    assert len(c["pillars"]) == 4
    assert all(p["twelve_fortune"] in S.TWELVE for p in c["pillars"])


def test_want_long_twelve_fortune_and_tenchusatsu():
    c = S.build_chart(date(1999, 1, 22))          # 日主 甲, 天中殺 申酉
    ds, void = c["day_stem_idx"], c["void"]
    wl_tf = S.make_want_long(SuimeiSpec(entry_signal="twelve_fortune"), ds, void)
    wl_tc = S.make_want_long(SuimeiSpec(entry_signal="avoid_tenchusatsu"), ds, void)
    for y in (2021, 2022, 2023, 2024, 2025):
        d = date(y, 6, 1)
        lb = S.liunian_branch(d)
        assert wl_tf(d) == (S.twelve_fortune(ds, lb) in S.THRIVING)
        assert wl_tc(d) == (lb not in void)
    assert S.make_want_long(SuimeiSpec(entry_signal="buy_and_hold"), ds, void)(date(2024, 1, 1))
