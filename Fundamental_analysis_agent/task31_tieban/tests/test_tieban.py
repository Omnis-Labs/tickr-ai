"""Tests for the 鐵板神數 placebo engine. No network (pure computation)."""

from __future__ import annotations

from datetime import date

from task31_tieban.pipeline import tieban as T
from task31_tieban.schemas import TiebanSpec


def test_taixuan_tables():
    # 甲己=9, 戊癸=5 ; 子午=9, 巳亥=4
    assert T._STEM_TAIXUAN[0] == 9 and T._STEM_TAIXUAN[5] == 9 and T._STEM_TAIXUAN[4] == 5
    assert T._BRANCH_TAIXUAN[0] == 9 and T._BRANCH_TAIXUAN[6] == 9 and T._BRANCH_TAIXUAN[5] == 4


def test_ming_number_deterministic_and_positive():
    m1 = T.ming_number(date(1999, 1, 22))
    m2 = T.ming_number(date(1999, 1, 22))
    assert m1 == m2 and 30 <= m1 <= 80     # 8 chars × (4..9)


def test_verdict_cycle():
    assert T.verdict(0) == "吉" and T.verdict(1) == "平" and T.verdict(2) == "凶"


def test_want_long_modes():
    ming = T.ming_number(date(1999, 1, 22))
    wl_v = T.make_want_long(TiebanSpec(entry_signal="verse_fortune"), ming)
    wl_a = T.make_want_long(TiebanSpec(entry_signal="avoid_inauspicious"), ming)
    for y in (2021, 2022, 2023, 2024, 2025):
        d = date(y, 6, 1)
        v = T.verdict(T.liunian_number(ming, d))
        assert wl_v(d) == (v == "吉")
        assert wl_a(d) == (v != "凶")
    assert T.make_want_long(TiebanSpec(entry_signal="buy_and_hold"), ming)(date(2024, 1, 1))
