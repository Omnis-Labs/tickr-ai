"""八字（四柱）deterministic engine. Pure, offline, lookahead-free.

A company's natal chart is cast from its **listing/first-trade date** (the firm's
"birth"). From the four pillars we read the 日主 (Day Master) element, estimate the
chart's 旺衰 (strength), and derive its 喜用神 (favorable elements). The trading signal
holds the stock when the *current* period's 流年/流月 element is favourable to the Day
Master, and stands aside otherwise — a deterministic function of the date, so it can
never peek ahead.

⚠️ This is a CONTROL / PLACEBO: 八字 has no economic mechanism. The engine is exact
where it can be (the day pillar is pinned to the verifiable anchor 2000-01-07 = 甲子日;
the year pillar to 1984 = 甲子年); solar-term month boundaries are the standard ±1-day
approximations, and the listing time-of-day is assumed to be the US market open
(09:30 → 巳時) since IPO clock-times aren't published. None of that affects the point:
a worthless signal, run through the same honest backtest.
"""

from __future__ import annotations

from datetime import date, datetime

STEMS = "甲乙丙丁戊己庚辛壬癸"
BRANCHES = "子丑寅卯辰巳午未申酉戌亥"
STEM_ELEM = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"]
STEM_YINYANG = ["陽", "陰", "陽", "陰", "陽", "陰", "陽", "陰", "陽", "陰"]
BRANCH_ELEM = ["水", "土", "木", "木", "土", "火", "火", "土", "金", "金", "土", "水"]
BRANCH_ZODIAC = ["鼠", "牛", "虎", "兔", "龍", "蛇", "馬", "羊", "猴", "雞", "狗", "豬"]

SHENG = {"木": "火", "火": "土", "土": "金", "金": "水", "水": "木"}   # A 生 B
KE = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}        # A 剋 B
_GEN_OF = {v: k for k, v in SHENG.items()}                            # who generates X
_CTRL_OF = {v: k for k, v in KE.items()}                             # who controls X

# solar-term month boundaries (approx, ±1 day) → 月支 index (子=0…亥=11)
# each entry: (month, day, branch_idx, term)
_MONTH_TERMS = [
    (1, 6, 1, "小寒→丑"), (2, 4, 2, "立春→寅"), (3, 6, 3, "驚蟄→卯"), (4, 5, 4, "清明→辰"),
    (5, 6, 5, "立夏→巳"), (6, 6, 6, "芒種→午"), (7, 7, 7, "小暑→未"), (8, 8, 8, "立秋→申"),
    (9, 8, 9, "白露→酉"), (10, 8, 10, "寒露→戌"), (11, 7, 11, "立冬→亥"), (12, 7, 0, "大雪→子"),
]


def _jdn(y: int, m: int, d: int) -> int:
    a = (14 - m) // 12
    yy = y + 4800 - a
    mm = m + 12 * a - 3
    return d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045


def day_pillar(d: date) -> tuple[int, int]:
    """(stem_idx, branch_idx). Pinned: 2000-01-07 = 甲子日 (idx 0)."""
    i = (_jdn(d.year, d.month, d.day) + 49) % 60
    return i % 10, i % 12


def _solar_year(d: date) -> int:
    """八字 year rolls at 立春 (~Feb 4)."""
    return d.year if (d.month, d.day) >= (2, 4) else d.year - 1


def year_pillar(d: date) -> tuple[int, int]:
    """(stem_idx, branch_idx). Pinned: 1984 = 甲子年."""
    y = _solar_year(d)
    return (y - 4) % 10, (y - 4) % 12


def _month_branch(d: date) -> int:
    branch = 0
    for (mo, day, bi, _term) in _MONTH_TERMS:
        if (d.month, d.day) >= (mo, day):
            branch = bi
    # before 小寒 (early Jan) belongs to the previous 子 month
    if (d.month, d.day) < (1, 6):
        branch = 0
    return branch


def month_pillar(d: date) -> tuple[int, int]:
    """Month branch by solar term; month stem via 五虎遁 (年上起月)."""
    yb_stem, _ = year_pillar(d)
    base_yin = (2 + 2 * (yb_stem % 5)) % 10           # stem of the 寅 month for this year
    mb = _month_branch(d)
    offset = (mb - 2) % 12                            # months counted from 寅
    return (base_yin + offset) % 10, mb


def hour_pillar(day_stem: int, hour: int) -> tuple[int, int]:
    """Hour branch from clock hour; hour stem via 五鼠遁 (日上起時)."""
    hb = ((hour + 1) // 2) % 12                       # 23–1→子(0) … 9–11→巳(5)
    base_zi = (2 * (day_stem % 5)) % 10
    return (base_zi + hb) % 10, hb


def four_pillars(d: date, hour: int = 9) -> dict:
    """The natal 命盤: 年/月/日/時 pillars (listing hour defaults to market open → 巳時)."""
    ys, yb = year_pillar(d)
    ms, mb = month_pillar(d)
    ds, db = day_pillar(d)
    hs, hb = hour_pillar(ds, hour)
    def pil(s, b):
        return {"stem": STEMS[s], "branch": BRANCHES[b], "stem_elem": STEM_ELEM[s],
                "branch_elem": BRANCH_ELEM[b], "zodiac": BRANCH_ZODIAC[b],
                "gz": STEMS[s] + BRANCHES[b], "stem_idx": s, "branch_idx": b}
    return {"year": pil(ys, yb), "month": pil(ms, mb), "day": pil(ds, db), "hour": pil(hs, hb)}


def strength_and_favourable(pillars: dict) -> dict:
    """Estimate 旺衰 of the Day Master and pick 喜用神 (favourable five-element set)."""
    dm = pillars["day"]["stem_elem"]                  # 日主 element
    # gather the other 7 chars' elements, weighting the 月令 (month branch) ×2
    chars: list[tuple[str, int]] = []
    for key in ("year", "month", "day", "hour"):
        p = pillars[key]
        chars.append((p["stem_elem"], 1))
        chars.append((p["branch_elem"], 2 if key == "month" else 1))
    support = drain = 0
    for elem, w in chars:
        if elem == dm or SHENG.get(elem) == dm:       # 同 or 印 (generates DM)
            support += w
        else:                                         # 洩/官殺/財 — all consume DM
            drain += w
    strong = support >= drain
    if strong:
        fav = {SHENG[dm], KE[dm], _CTRL_OF[dm]}        # drain / exhaust / control
        label = "身強（喜洩剋耗）"
    else:
        fav = {_GEN_OF[dm], dm}                        # 印 + 比劫 (resource + peer)
        label = "身弱（喜生扶）"
    return {"day_master": pillars["day"]["stem"], "dm_elem": dm, "strong": strong,
            "label": label, "favourable": sorted(fav), "support": support, "drain": drain}


def liunian_elem(d: date) -> str:
    """流年五行 — the year stem's element for date d."""
    return STEM_ELEM[year_pillar(d)[0]]


def liuyue_elem(d: date) -> str:
    """流月五行 — the month stem's element for date d."""
    return STEM_ELEM[month_pillar(d)[0]]


def make_want_long(spec, fav: set[str]):
    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "favorable_year":
            return liunian_elem(d) in fav
        if spec.entry_signal == "favorable_month":
            return liuyue_elem(d) in fav
        return False
    return want_long
