"""Pure-Python 紫微斗數 engine — no native deps (lunardate only), so it deploys anywhere.

Replaces py-iztro (which transitively needs pythonmonkey→pminit, and pminit has NO
linux wheels → undeployable on the prod container). This engine reproduces iztro's
14-major-star placement + 命宮 + 五行局 + 文昌文曲左輔右弼 EXACTLY (verified cell-by-cell
against py-iztro as an oracle across many tickers — see tests). All standard 紫微
algorithms:

  命宮  = 寅起正月順數至生月，再從該宮起子時逆數至生時
  五行局 = 納音五行 of 命宮干支 (水2 木3 金4 土5 火6)
  紫微  = 安紫微訣 from 五行局 + 農曆日
  14 主星 = 紫微系 (逆) + 天府系 (順), 天府 = (4 − 紫微) mod 12
  昌曲輔弼 = standard 時支/月支 安法

Branch index: 子0 丑1 寅2 卯3 辰4 巳5 午6 未7 申8 酉9 戌10 亥11.
"""

from __future__ import annotations

from datetime import date

from lunardate import LunarDate

BRANCHES = "子丑寅卯辰巳午未申酉戌亥"
STEMS = "甲乙丙丁戊己庚辛壬癸"
PALACE_NAMES = ["命宮", "兄弟", "夫妻", "子女", "財帛", "疾厄", "遷移", "僕役", "官祿", "田宅", "福德", "父母"]

# 納音五行 of the 30 sexagenary pairs (index = sexagenary// 2)
_NAYIN = ["金", "火", "木", "土", "金", "火", "水", "土", "金", "木", "水", "土", "火", "木", "水",
          "金", "火", "木", "土", "金", "火", "水", "土", "金", "木", "水", "土", "火", "木", "水"]
_ELEM_JU = {"水": 2, "木": 3, "金": 4, "土": 5, "火": 6}

# 紫微系 offsets (逆, subtract) and 天府系 offsets (順, add)
_ZIWEI_SERIES = {"紫微": 0, "天機": -1, "太陽": -3, "武曲": -4, "天同": -5, "廉貞": -8}
_TIANFU_SERIES = {"天府": 0, "太陰": 1, "貪狼": 2, "巨門": 3, "天相": 4, "天梁": 5, "七殺": 6, "破軍": 10}
# 命主 by 命宮地支, 身主 by 生年地支 (iztro's r.soul / r.body)
_MING_ZHU = ["貪狼", "巨門", "祿存", "文曲", "廉貞", "武曲", "破軍", "武曲", "廉貞", "文曲", "祿存", "巨門"]
_SHEN_ZHU = ["火星", "天相", "天梁", "天同", "文昌", "天機", "鈴星", "天相", "天梁", "天同", "文昌", "天機"]


def _sexagenary(stem: int, branch: int) -> int:
    for n in range(60):
        if n % 10 == stem and n % 12 == branch:
            return n
    raise ValueError("bad 干支")


def life_palace_branch(lunar_month: int, hour_branch: int) -> int:
    month_palace = (2 + (lunar_month - 1)) % 12          # 寅起正月, 順
    return (month_palace - hour_branch) % 12             # 起子時逆數至生時


def life_palace_stem(lunar_year: int, palace_branch: int) -> int:
    year_stem = (lunar_year - 4) % 10
    base_yin = (2 + 2 * (year_stem % 5)) % 10            # 五虎遁: 寅宮 stem
    offset = (palace_branch - 2) % 12                    # palace stems run 順 from 寅 (寅=0…丑=11)
    return (base_yin + offset) % 10


def five_elements_class(lunar_year: int, palace_branch: int) -> tuple[str, int]:
    stem = life_palace_stem(lunar_year, palace_branch)
    elem = _NAYIN[_sexagenary(stem, palace_branch) // 2]
    return elem, _ELEM_JU[elem]


def ziwei_branch(juju: int, lunar_day: int) -> int:
    shang = -(-lunar_day // juju)                        # ceil(day/juju)
    yu = shang * juju - lunar_day
    base = (2 + shang - 1) % 12                          # 寅 + (商-1)
    if yu == 0:
        return base
    return (base - yu) % 12 if yu % 2 == 1 else (base + yu) % 12


def major_star_positions(zw: int) -> dict[str, int]:
    """branch index of each of the 14 major stars."""
    fu = (4 - zw) % 12
    out = {name: (zw + off) % 12 for name, off in _ZIWEI_SERIES.items()}
    out.update({name: (fu + off) % 12 for name, off in _TIANFU_SERIES.items()})
    return out


def aux_star_positions(lunar_month: int, hour_branch: int) -> dict[str, int]:
    """文昌/文曲/左輔/右弼 — the 四化-able auxiliary stars."""
    return {
        "文昌": (10 - hour_branch) % 12,                  # 戌起子時逆
        "文曲": (4 + hour_branch) % 12,                   # 辰起子時順
        "左輔": (4 + (lunar_month - 1)) % 12,             # 辰起正月順
        "右弼": (10 - (lunar_month - 1)) % 12,            # 戌起正月逆
    }


def build_chart(listing: date) -> dict:
    """Full natal chart: palace names+branches, star→palace map, 命宮/五行局. iztro-equivalent."""
    ld = LunarDate.fromSolarDate(listing.year, listing.month, listing.day)
    lunar_month, lunar_day, lunar_year = ld.month, ld.day, ld.year
    hour_branch = 5                                       # 09:30 市場開盤 → 巳時
    life_b = life_palace_branch(lunar_month, hour_branch)
    body_b = (((2 + (lunar_month - 1)) % 12) + hour_branch) % 12   # 身宮 = 月宮起子時順數至生時
    year_branch = (lunar_year - 4) % 12
    elem, juju = five_elements_class(lunar_year, life_b)
    zw = ziwei_branch(juju, lunar_day)

    star_branch: dict[str, int] = {}
    star_branch.update(major_star_positions(zw))
    star_branch.update(aux_star_positions(lunar_month, hour_branch))

    # palace name at each branch: name[i] sits at (命宮 − i) mod 12
    branch_palace = {(life_b - i) % 12: PALACE_NAMES[i] for i in range(12)}
    star_palace = {s: branch_palace[b] for s, b in star_branch.items()}

    palaces = []
    for b in range(12):
        stars = sorted([s for s, bb in star_branch.items() if bb == b],
                       key=lambda s: 0 if s in _ZIWEI_SERIES or s in _TIANFU_SERIES else 1)
        palaces.append({"name": branch_palace[b], "branch": BRANCHES[b],
                        "is_body": b == body_b, "stars": stars})
    return {
        "soul": _MING_ZHU[life_b], "body": _SHEN_ZHU[year_branch],
        "five_elements_class": f"{elem}{'二三四五六'[juju - 2]}局",
        "palaces": palaces, "star_palace": star_palace,
        "life_branch": BRANCHES[life_b], "ziwei_branch": BRANCHES[zw],
    }
