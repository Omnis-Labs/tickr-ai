"""Plum-Blossom (梅花易數) deterministic I Ching engine. Pure, offline, lookahead-free.

Time-based casting (時間起卦): the decision date's integers fix the upper trigram,
lower trigram, and moving line — so a date maps to ONE hexagram, fully reproducible
and auditable, with zero lookahead (a calendar date leaks nothing about prices). A
`seed` shifts the casting deterministically, which is what the null-distribution
harness uses to draw many independent placebo draws.

The signal comes from the 體用五行生剋 (body/use five-element generation–restriction)
verdict — a fixed rule. The LLM only writes the 卦辭 narrative; it cannot move the
backtest (selection ≠ execution).
"""

from __future__ import annotations

from datetime import date

# 先天 (Fuxi) order & numbers: 乾1 兌2 離3 震4 巽5 坎6 艮7 坤8
ORDER = ["乾", "兌", "離", "震", "巽", "坎", "艮", "坤"]
# lines bottom→top, 1 = yang (⚊), 0 = yin (⚋)
TRIGRAMS = {
    "乾": {"lines": (1, 1, 1), "wuxing": "金", "symbol": "☰", "en": "Heaven", "yang": True},
    "兌": {"lines": (1, 1, 0), "wuxing": "金", "symbol": "☱", "en": "Lake", "yang": False},
    "離": {"lines": (1, 0, 1), "wuxing": "火", "symbol": "☲", "en": "Fire", "yang": False},
    "震": {"lines": (1, 0, 0), "wuxing": "木", "symbol": "☳", "en": "Thunder", "yang": True},
    "巽": {"lines": (0, 1, 1), "wuxing": "木", "symbol": "☴", "en": "Wind", "yang": False},
    "坎": {"lines": (0, 1, 0), "wuxing": "水", "symbol": "☵", "en": "Water", "yang": True},
    "艮": {"lines": (0, 0, 1), "wuxing": "土", "symbol": "☶", "en": "Mountain", "yang": True},
    "坤": {"lines": (0, 0, 0), "wuxing": "土", "symbol": "☷", "en": "Earth", "yang": False},
}

# King Wen number table — KW[lower][upper] (rows = 下卦, cols = 上卦), ORDER for both.
_KW = {
    "乾": [1, 43, 14, 34, 9, 5, 26, 11],
    "兌": [10, 58, 38, 54, 61, 60, 41, 19],
    "離": [13, 49, 30, 21, 37, 63, 22, 36],
    "震": [25, 17, 55, 51, 42, 3, 27, 24],
    "巽": [44, 28, 50, 32, 57, 48, 18, 46],
    "坎": [6, 47, 64, 40, 59, 29, 4, 7],
    "艮": [33, 31, 56, 62, 53, 39, 52, 15],
    "坤": [12, 45, 35, 16, 20, 8, 23, 2],
}
# Hmm: _KW rows must be indexed by LOWER, cols by UPPER. Built/verified that way.

NAMES = {
    1: "乾為天", 2: "坤為地", 3: "水雷屯", 4: "山水蒙", 5: "水天需", 6: "天水訟", 7: "地水師", 8: "水地比",
    9: "風天小畜", 10: "天澤履", 11: "地天泰", 12: "天地否", 13: "天火同人", 14: "火天大有", 15: "地山謙",
    16: "雷地豫", 17: "澤雷隨", 18: "山風蠱", 19: "地澤臨", 20: "風地觀", 21: "火雷噬嗑", 22: "山火賁",
    23: "山地剝", 24: "地雷復", 25: "天雷無妄", 26: "山天大畜", 27: "山雷頤", 28: "澤風大過", 29: "坎為水",
    30: "離為火", 31: "澤山咸", 32: "雷風恆", 33: "天山遯", 34: "雷天大壯", 35: "火地晉", 36: "地火明夷",
    37: "風火家人", 38: "火澤睽", 39: "水山蹇", 40: "雷水解", 41: "山澤損", 42: "風雷益", 43: "澤天夬",
    44: "天風姤", 45: "澤地萃", 46: "地風升", 47: "澤水困", 48: "水風井", 49: "澤火革", 50: "火風鼎",
    51: "震為雷", 52: "艮為山", 53: "風山漸", 54: "雷澤歸妹", 55: "雷火豐", 56: "火山旅", 57: "巽為風",
    58: "兌為澤", 59: "風水渙", 60: "水澤節", 61: "風澤中孚", 62: "雷山小過", 63: "水火既濟", 64: "火水未濟",
}

# 五行: generation 生 cycle and restriction 剋 cycle
_SHENG = {"金": "水", "水": "木", "木": "火", "火": "土", "土": "金"}   # A 生 B
_KE = {"金": "木", "木": "土", "土": "水", "水": "火", "火": "金"}        # A 剋 B


def _trigram_by_lines(lines: tuple[int, int, int]) -> str:
    for name, t in TRIGRAMS.items():
        if t["lines"] == lines:
            return name
    raise ValueError(f"no trigram for {lines}")


def kingwen(upper: str, lower: str) -> tuple[int, str]:
    num = _KW[lower][ORDER.index(upper)]
    return num, NAMES[num]


def cast(d: date, seed: int = 0) -> dict:
    """Deterministic time-cast: date(+seed) → upper/lower trigrams + moving line (1..6)."""
    y, m, day = d.year, d.month, d.day
    doy = d.timetuple().tm_yday
    upper = ORDER[((y + m + day + seed) % 8) - 1]
    lower = ORDER[((y + m + day + doy + seed) % 8) - 1]
    moving = ((y + m + day + doy + seed) % 6) or 6        # 1..6, bottom→top
    return {"upper": upper, "lower": lower, "moving": moving}


def _lines_bottom_top(upper: str, lower: str) -> list[int]:
    # bottom→top: lower trigram lines (1-3) then upper trigram lines (4-6)
    return list(TRIGRAMS[lower]["lines"]) + list(TRIGRAMS[upper]["lines"])


def wuxing_relation(ti: str, yong: str) -> tuple[str, str, bool]:
    """Five-element relation between 體 (ti) and 用 (yong) elements.
    Returns (relation_label, verdict 吉/凶/平, auspicious_bool)."""
    te, ye = TRIGRAMS[ti]["wuxing"], TRIGRAMS[yong]["wuxing"]
    if te == ye:
        return "比和（同氣相求）", "吉", True
    if _SHENG.get(ye) == te:
        return "用生體（外來生我）", "吉", True
    if _KE.get(te) == ye:
        return "體剋用（我能制彼）", "小吉", True
    if _SHENG.get(te) == ye:
        return "體生用（我洩於彼）", "凶（耗洩）", False
    if _KE.get(ye) == te:
        return "用剋體（彼來剋我）", "凶（受制）", False
    return "無直接生剋", "平", False


def divine(d: date, seed: int = 0) -> dict:
    """Full 命盤: 本卦 / 互卦 / 變卦, 體用 assignment, 五行生剋 verdict, line diagram."""
    c = cast(d, seed)
    upper, lower, moving = c["upper"], c["lower"], c["moving"]
    ben_num, ben_name = kingwen(upper, lower)
    lines = _lines_bottom_top(upper, lower)

    # 互卦 (nuclear): lower nuclear = lines 2-3-4, upper nuclear = lines 3-4-5 (1-indexed bottom→top)
    hu_lower = _trigram_by_lines(tuple(lines[1:4]))
    hu_upper = _trigram_by_lines(tuple(lines[2:5]))
    hu_num, hu_name = kingwen(hu_upper, hu_lower)

    # 變卦 (changed): flip the moving line
    changed = list(lines)
    changed[moving - 1] ^= 1
    bian_lower = _trigram_by_lines(tuple(changed[0:3]))
    bian_upper = _trigram_by_lines(tuple(changed[3:6]))
    bian_num, bian_name = kingwen(bian_upper, bian_lower)

    # 體用: trigram CONTAINING the moving line = 用 (use/other), the other = 體 (body/self)
    if moving <= 3:
        yong, ti = lower, upper
    else:
        yong, ti = upper, lower
    relation, verdict, auspicious = wuxing_relation(ti, yong)

    return {
        "upper": upper, "lower": lower, "moving": moving, "lines": lines,
        "ben_num": ben_num, "ben_name": ben_name,
        "hu_num": hu_num, "hu_name": hu_name,
        "bian_num": bian_num, "bian_name": bian_name,
        "ti": ti, "yong": yong, "ti_wuxing": TRIGRAMS[ti]["wuxing"], "yong_wuxing": TRIGRAMS[yong]["wuxing"],
        "relation": relation, "verdict": verdict, "auspicious": auspicious,
        "ti_is_yang": TRIGRAMS[ti]["yang"],
    }


def line_diagram(div: dict) -> list[str]:
    """6 lines top→bottom for display, moving line marked with ●."""
    rows = []
    for idx in range(5, -1, -1):              # top (line 6) → bottom (line 1)
        yang = div["lines"][idx] == 1
        glyph = "▅▅▅▅▅" if yang else "▅▅　▅▅"
        mark = " ●動" if (idx + 1) == div["moving"] else ""
        rows.append(f"{glyph}{mark}")
    return rows
