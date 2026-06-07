"""Tests for the 梅花易數 placebo engine. No network (pure computation)."""

from __future__ import annotations

from datetime import date

from task26_meihua.pipeline import iching as I
from task26_meihua.pipeline.signals import build_divinations, make_want_long, to_chart
from task26_meihua.schemas import MeihuaSpec


def test_kingwen_anchors():
    assert I.kingwen("乾", "乾") == (1, "乾為天")
    assert I.kingwen("坤", "坤") == (2, "坤為地")
    assert I.kingwen("坎", "震") == (3, "水雷屯")
    assert I.kingwen("坎", "坎") == (29, "坎為水")
    assert I.kingwen("離", "離") == (30, "離為火")


def test_all_64_hexagrams_distinct():
    seen = {I.kingwen(u, lo)[0] for u in I.ORDER for lo in I.ORDER}
    assert seen == set(range(1, 65))


def test_cast_is_deterministic_and_seed_shifts():
    d = date(2024, 6, 7)
    assert I.cast(d, 0) == I.cast(d, 0)            # reproducible
    # a different seed generally yields a different casting
    assert I.cast(d, 0) != I.cast(d, 3)
    c = I.cast(d, 0)
    assert c["upper"] in I.ORDER and c["lower"] in I.ORDER and 1 <= c["moving"] <= 6


def test_divine_structure_and_ti_yong():
    div = I.divine(date(2024, 6, 7), 0)
    # 體 is the trigram WITHOUT the moving line
    if div["moving"] <= 3:
        assert div["yong"] == div["lower"] and div["ti"] == div["upper"]
    else:
        assert div["yong"] == div["upper"] and div["ti"] == div["lower"]
    assert isinstance(div["auspicious"], bool)
    assert div["verdict"] in ("吉", "小吉", "凶（耗洩）", "凶（受制）", "平")


def test_wuxing_relation_rules():
    # 用生體: use element generates body element → auspicious. 金生水 → ti=水, yong=金
    rel, verdict, ausp = I.wuxing_relation("坎", "乾")   # 坎=水(體), 乾=金(用); 金生水 = 用生體
    assert ausp and "用生體" in rel
    # 用剋體: 金剋木 → ti=木(震), yong=金(乾) → inauspicious
    rel2, _v2, ausp2 = I.wuxing_relation("震", "乾")
    assert not ausp2 and "用剋體" in rel2


def test_want_long_follows_auspicious():
    dates = [date(2024, 6, 7), date(2024, 7, 1)]
    divs = build_divinations(dates, 0)
    wl = make_want_long(MeihuaSpec(entry_signal="ti_yong_auspicious", seed=0), divs)
    for d in dates:
        assert wl(d) == divs[d]["auspicious"]
    wl_bh = make_want_long(MeihuaSpec(entry_signal="buy_and_hold", seed=0), divs)
    assert all(wl_bh(d) for d in dates)


def test_chart_renders_six_lines():
    chart = to_chart(I.divine(date(2024, 6, 7), 0))
    assert len(chart.line_diagram) == 6 and chart.ben_gua.startswith("#")
