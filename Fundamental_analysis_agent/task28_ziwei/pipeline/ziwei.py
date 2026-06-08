"""紫微斗數（含四化飛星）deterministic engine. Lookahead-free.

A company's natal 命盤 is cast from its **listing date** (treated as the firm's
birth, hour fixed to the US market open 09:30 → 巳時). The 14 major stars, 12 palaces,
五行局 and natal 四化 come from the `py_iztro` engine (the iztro 紫微 implementation).

The trading signal is the **四化飛星** application: each year's 天干 transforms four
stars (化祿/化權/化科/化忌); we track which NATAL palace each flown star lands in. When
化祿/化權 fly into the life/wealth/career palaces (命宮 / 財帛 / 官祿) the period is
favourable (hold); when 化忌 flies into them it is unfavourable (flat). Everything is a
pure function of the date, so it can never peek ahead.

⚠️ CONTROL / PLACEBO: 紫微斗數 has no economic mechanism. py_iztro is imported lazily so
a missing wheel degrades gracefully instead of breaking app startup. The 流年/流月 干支
reuse Task 27's verified 八字 calendar (立春-anchored).
"""

from __future__ import annotations

from datetime import date

from task27_bazi.pipeline import bazi as B   # reuse the verified year/month-stem calendar

# iztro's 四化 table (年干 → 化祿/化權/化科/化忌), extracted from py_iztro for consistency.
SIHUA = {
    "甲": ["廉貞", "破軍", "武曲", "太陽"], "乙": ["天機", "天梁", "紫微", "太陰"],
    "丙": ["天同", "天機", "文昌", "廉貞"], "丁": ["太陰", "天同", "天機", "巨門"],
    "戊": ["貪狼", "太陰", "右弼", "天機"], "己": ["武曲", "貪狼", "天梁", "文曲"],
    "庚": ["太陽", "武曲", "太陰", "天同"], "辛": ["巨門", "太陽", "文曲", "文昌"],
    "壬": ["天梁", "紫微", "左輔", "武曲"], "癸": ["破軍", "巨門", "太陰", "貪狼"],
}
HUA = ["祿", "權", "科", "忌"]
TARGET = {"命宮", "財帛", "官祿"}        # life / wealth / career — what matters for a firm
_HOUR_INDEX = 5                          # 09:30 市場開盤 → 巳時


class EngineUnavailable(RuntimeError):
    pass


def build_natal(listing: date) -> dict:
    """Cast the natal 命盤 via py_iztro. Returns palaces + star→palace map + meta."""
    try:
        from py_iztro import Astro
    except Exception as e:  # noqa: BLE001
        raise EngineUnavailable(f"py_iztro unavailable: {type(e).__name__}") from e
    r = Astro().by_solar(f"{listing.year}-{listing.month}-{listing.day}", _HOUR_INDEX, "男", True, "zh-TW")
    palaces = []
    star_palace: dict[str, str] = {}
    for p in r.palaces:
        majors = [(s.name, getattr(s, "mutagen", "") or "") for s in p.major_stars]
        minors = [(s.name, getattr(s, "mutagen", "") or "") for s in getattr(p, "minor_stars", [])]
        for nm, _mut in majors + minors:
            star_palace[nm] = p.name
        palaces.append({
            "name": p.name, "branch": p.earthly_branch, "is_body": bool(getattr(p, "is_body_palace", False)),
            "stars": [nm + (f"({mut})" if mut else "") for nm, mut in majors] + [nm for nm, _ in minors],
        })
    return {
        "soul": r.soul, "body": r.body, "five_elements_class": r.five_elements_class,
        "palaces": palaces, "star_palace": star_palace,
    }


def liunian_sihua(d: date) -> tuple[str, list[str]]:
    """(年干, [祿星,權星,科星,忌星]) for date d — 立春-anchored via the 八字 calendar."""
    stem = B.STEMS[B.year_pillar(d)[0]]
    return stem, SIHUA[stem]


def liuyue_sihua(d: date) -> tuple[str, list[str]]:
    stem = B.STEMS[B.month_pillar(d)[0]]
    return stem, SIHUA[stem]


def _score(star_palace: dict[str, str], mutagen: list[str]) -> tuple[int, int, dict[str, str]]:
    """飛星 landing: 化祿/化權 into 命財官 = favourable; 化忌 into them = unfavourable."""
    lu, quan, _ke, ji = mutagen
    landing = {f"化{HUA[i]}": f"{mutagen[i]}→{star_palace.get(mutagen[i], '?')}" for i in range(4)}
    fav = sum(1 for s in (lu, quan) if star_palace.get(s) in TARGET)
    unfav = 1 if star_palace.get(ji) in TARGET else 0
    return fav, unfav, landing


def make_want_long(spec, star_palace: dict[str, str]):
    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "sihua_year":
            _stem, mut = liunian_sihua(d)
        elif spec.entry_signal == "sihua_month":
            _stem, mut = liuyue_sihua(d)
        else:
            return False
        fav, unfav, _ = _score(star_palace, mut)
        return fav > unfav
    return want_long


def ziwei_readings(natal: dict, as_of: date) -> dict[str, float | str]:
    stem, mut = liunian_sihua(as_of)
    fav, unfav, landing = _score(natal["star_palace"], mut)
    return {
        "ziwei_regime": "favourable_year" if fav > unfav else "unfavourable_year",
        "soul_star": natal["soul"], "body_star": natal["body"],
        "five_elements_class": natal["five_elements_class"],
        "liunian_stem": stem,
        "liunian_sihua": "、".join(f"{mut[i]}化{HUA[i]}" for i in range(4)),
        "sihua_landing": " ".join(f"{k}:{v}" for k, v in landing.items()),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["ziwei_regime", "soul_star", "body_star", "five_elements_class",
             "liunian_stem", "liunian_sihua", "sihua_landing"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def reasoning_chain(natal: dict, as_of: date) -> list[str]:
    stem, mut = liunian_sihua(as_of)
    fav, unfav, landing = _score(natal["star_palace"], mut)
    return [
        f"排盤（上市日，時辰以開盤 09:30＝巳時為準）：命宮主星 {natal['soul']}、身宮主星 {natal['body']}、{natal['five_elements_class']}。",
        f"流年天干＝{stem}，四化：" + "、".join(f"{mut[i]}化{HUA[i]}" for i in range(4)) + "。",
        "四化飛星落宮：" + "；".join(f"{k} {v}" for k, v in landing.items()) + "。",
        f"命財官三宮（命宮/財帛/官祿）：化祿權入 {fav} 顆、化忌入 {unfav} 顆。",
        f"訊號：{'祿權入命財官，吉 → 持有' if fav > unfav else '忌入或祿權不入命財官 → 空手'}。",
    ]
