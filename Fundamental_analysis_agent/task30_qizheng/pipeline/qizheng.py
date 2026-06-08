"""七政四餘 (Chinese horoscopic astrology) deterministic engine. Offline, lookahead-free.

七政 = 日月 + 水金火木土 (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn).
四餘 = 羅睺 (Moon's ascending node), 計都 (descending node), 月孛 (lunar apogee), 紫炁
       (a fictitious slow point — defined mean motion, no astronomical basis: caveated).
All from `ephem` + standard mean-element formulas → pure functions of the date.

命主 = the natal Sun's ecliptic position (太陽躔度). Signal rides the 七政四餘 transits:
  • benefic_transit  — hold when 歲星 (Jupiter, the great benefic) is in a sign that
                       conjoins or trines (三合) the natal Sun's sign.
  • avoid_malefic    — stand aside when 火星 (Mars) or 羅睺 conjoins/opposes the natal Sun.
Reuses Task 25's zodiac-sign helpers.

⚠️ CONTROL / PLACEBO — no economic mechanism.
"""

from __future__ import annotations

import math
from datetime import date

import ephem

from task25_astro.pipeline import astro as A   # reuse sign_of / sign_zh

SEVEN = {"日": ephem.Sun, "月": ephem.Moon, "水": ephem.Mercury, "金": ephem.Venus,
         "火": ephem.Mars, "木": ephem.Jupiter, "土": ephem.Saturn}


def _lon(body_cls, d: date) -> float:
    b = body_cls()
    b.compute(ephem.Date(d))
    return math.degrees(ephem.Ecliptic(b).lon) % 360.0


def _julian_centuries(d: date) -> float:
    jd = ephem.julian_date(ephem.Date(d))
    return (jd - 2451545.0) / 36525.0


def four_remainders(d: date) -> dict[str, float]:
    """四餘 mean longitudes (deg). Node/apogee are standard mean elements; 紫炁 is a
    defined fictitious slow point (period ≈ 28 yr from a fixed epoch)."""
    t = _julian_centuries(d)
    node = (125.0445 - 1934.1363 * t) % 360.0          # 月之升交點 → 羅睺
    apogee = (83.3532 + 4069.0137 * t + 180.0) % 360.0  # 月孛 = 遠地點 (perigee + 180)
    years = (ephem.julian_date(ephem.Date(d)) - 2451545.0) / 365.25
    ziqi = (220.0 + (360.0 / 28.0) * years) % 360.0     # 紫炁: fictitious, ~28-yr mean motion
    return {"羅睺": node, "計都": (node + 180.0) % 360.0, "月孛": apogee, "紫炁": ziqi}


def chart_for(d: date) -> list[tuple[str, float, str]]:
    """(name, ecliptic_lon, sign) for the 七政 then the 四餘 — the natal 星盤 as-of d."""
    out = [(nm, round(_lon(cls, d), 2), A.sign_of(_lon(cls, d))) for nm, cls in SEVEN.items()]
    for nm, lon in four_remainders(d).items():
        out.append((nm, round(lon, 2), A.sign_of(lon)))
    return out


def _sign(lon: float) -> int:
    return int(lon // 30) % 12


def build_state(dates: list[date], natal_sun_sign: int) -> dict[date, dict]:
    """Per-date transit state used by the signal: Jupiter sign vs natal Sun sign (benefic),
    Mars/羅睺 sign vs natal Sun (malefic)."""
    trine = {(natal_sun_sign + k) % 12 for k in (0, 4, 8)}        # 三合 (conjunction + both trines)
    opp = {(natal_sun_sign + k) % 12 for k in (0, 6)}             # conjunction + opposition
    state: dict[date, dict] = {}
    for d in dates:
        jup = _sign(_lon(ephem.Jupiter, d))
        mars = _sign(_lon(ephem.Mars, d))
        node = _sign(four_remainders(d)["羅睺"])
        state[d] = {"benefic": jup in trine, "malefic": (mars in opp) or (node in opp)}
    return state


def make_want_long(spec, state: dict[date, dict]):
    def want_long(d: date) -> bool:
        s = state.get(d)
        if spec.entry_signal == "buy_and_hold":
            return True
        if s is None:
            return False
        if spec.entry_signal == "benefic_transit":
            return s["benefic"]
        if spec.entry_signal == "avoid_malefic":
            return not s["malefic"]
        return False
    return want_long


def qizheng_readings(natal_sun_sign: int, d: date) -> dict[str, float | str]:
    jup = A.sign_of(_lon(ephem.Jupiter, d))
    mars = A.sign_of(_lon(ephem.Mars, d))
    node = A.sign_of(four_remainders(d)["羅睺"])
    sun_sign = A._SIGNS[natal_sun_sign]
    trine = {(natal_sun_sign + k) % 12 for k in (0, 4, 8)}
    opp = {(natal_sun_sign + k) % 12 for k in (0, 6)}
    benefic = _sign(_lon(ephem.Jupiter, d)) in trine
    malefic = (_sign(_lon(ephem.Mars, d)) in opp) or (_sign(four_remainders(d)["羅睺"]) in opp)
    regime = "malefic_affliction" if malefic else "benefic_blessing" if benefic else "neutral"
    return {
        "qizheng_regime": regime, "ming_zhu_sign": sun_sign,
        "jupiter_sign": jup, "mars_sign": mars, "rahu_sign": node,
        "jupiter_blesses": "是" if benefic else "否", "malefic_afflicts": "是" if malefic else "否",
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["qizheng_regime", "ming_zhu_sign", "jupiter_sign", "mars_sign", "rahu_sign",
             "jupiter_blesses", "malefic_afflicts"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def reasoning_chain(natal_sun_sign: int, d: date, natal_chart: list) -> list[str]:
    sun_sign = A._SIGNS[natal_sun_sign]
    seven = "、".join(f"{nm}{sign}" for nm, _lon_, sign in natal_chart[:7])
    siyu = "、".join(f"{nm}{sign}" for nm, _lon_, sign in natal_chart[7:])
    r = qizheng_readings(natal_sun_sign, d)
    return [
        f"立命（上市日 09:30 開盤）：命主太陽躔 {sun_sign}。",
        f"七政：{seven}。",
        f"四餘：{siyu}（羅睺=月升交點、計都=降交點、月孛=月遠地點、紫炁=虛擬之炁）。",
        f"流年躔度：歲星(木)入{r['jupiter_sign']}、火星入{r['mars_sign']}、羅睺入{r['rahu_sign']}。",
        f"歲星{'拱照命主（三合/同宮）' if r['jupiter_blesses'] == '是' else '未照命主'}；"
        f"火羅{'沖剋命主' if r['malefic_afflicts'] == '是' else '無沖'}。",
        f"訊號：{'持有（吉曜拱命）' if r['qizheng_regime'] == 'benefic_blessing' else '空手（凶曜沖命）' if r['qizheng_regime'] == 'malefic_affliction' else '依規則判定'}。",
    ]
