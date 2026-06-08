"""Tests for the 紫微斗數 placebo engine. No network (py_iztro is offline)."""

from __future__ import annotations

from datetime import date

import pytest

from task28_ziwei.pipeline import ziwei as Z
from task28_ziwei.schemas import ZiweiSpec


def test_sihua_table_canonical():
    # the well-known 年干四化: 甲 廉破武陽, 癸 破巨陰貪
    assert Z.SIHUA["甲"] == ["廉貞", "破軍", "武曲", "太陽"]
    assert Z.SIHUA["癸"] == ["破軍", "巨門", "太陰", "貪狼"]
    assert all(len(v) == 4 for v in Z.SIHUA.values()) and len(Z.SIHUA) == 10


def test_liunian_sihua_uses_lichun_year():
    # 2024 solar year = 甲 → 甲's 四化
    stem, mut = Z.liunian_sihua(date(2024, 6, 1))
    assert stem == "甲" and mut == ["廉貞", "破軍", "武曲", "太陽"]


def test_score_favourable_when_lu_quan_in_target():
    sp = {"廉貞": "命宮", "破軍": "財帛", "太陽": "兄弟"}
    fav, unfav, landing = Z._score(sp, ["廉貞", "破軍", "武曲", "太陽"])
    assert fav == 2 and unfav == 0           # 祿+權 into 命/財, 忌 not in target
    assert "化忌" in landing


def test_score_unfavourable_when_ji_in_target():
    sp = {"廉貞": "兄弟", "破軍": "田宅", "太陽": "官祿"}
    fav, unfav, _ = Z._score(sp, ["廉貞", "破軍", "武曲", "太陽"])
    assert fav == 0 and unfav == 1           # 忌 into 官祿


@pytest.mark.parametrize("listing", [date(1999, 1, 22), date(1986, 3, 13), date(1980, 12, 12)])
def test_build_natal_structure(listing):
    natal = Z.build_natal(listing)
    assert len(natal["palaces"]) == 12
    assert natal["soul"] and natal["five_elements_class"]
    names = {p["name"] for p in natal["palaces"]}
    assert {"命宮", "財帛", "官祿"} <= names
    # every flown-star key resolves to a palace
    assert all(v in names for v in natal["star_palace"].values())


def test_want_long_matches_score():
    natal = Z.build_natal(date(1999, 1, 22))
    wl = Z.make_want_long(ZiweiSpec(entry_signal="sihua_year"), natal["star_palace"])
    for y in (2022, 2023, 2024, 2025):
        d = date(y, 6, 1)
        _stem, mut = Z.liunian_sihua(d)
        fav, unfav, _ = Z._score(natal["star_palace"], mut)
        assert wl(d) == (fav > unfav)
    assert Z.make_want_long(ZiweiSpec(entry_signal="buy_and_hold"), {})(date(2024, 1, 1))
