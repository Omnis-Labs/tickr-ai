"""Deterministic financial-astrology engine. Pure, offline, lookahead-free.

Every quantity here is a function of the calendar date alone (planetary ecliptic
longitudes via `ephem`), so it can NEVER leak future prices — the placebo is, if
anything, cleaner than the real agents. Signals decided at close i execute open i+1
via the shared factor backtest.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import ephem

_SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
          "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]
_SIGNS_ZH = ["牡羊", "金牛", "雙子", "巨蟹", "獅子", "處女",
             "天秤", "天蠍", "射手", "摩羯", "水瓶", "雙魚"]
_BODIES = {
    "Sun": ephem.Sun, "Moon": ephem.Moon, "Mercury": ephem.Mercury, "Venus": ephem.Venus,
    "Mars": ephem.Mars, "Jupiter": ephem.Jupiter, "Saturn": ephem.Saturn,
}
# major Ptolemaic aspects → angular separation
_ASPECTS = {"conjunction": 0.0, "sextile": 60.0, "square": 90.0, "trine": 120.0, "opposition": 180.0}
_BENEFIC = ("conjunction", "sextile", "trine")


def _lon(body_cls, d: date) -> float:
    b = body_cls()
    b.compute(ephem.Date(d))
    return math.degrees(ephem.Ecliptic(b).lon) % 360.0


def sign_of(lon: float) -> str:
    return _SIGNS[int(lon // 30) % 12]


def sign_zh(lon: float) -> str:
    return _SIGNS_ZH[int(lon // 30) % 12]


def is_retrograde(body_cls, d: date) -> bool:
    """Apparent retrograde: ecliptic longitude decreasing day-over-day."""
    today = _lon(body_cls, d)
    tomorrow = _lon(body_cls, d + timedelta(days=1))
    delta = (tomorrow - today + 540.0) % 360.0 - 180.0    # signed shortest arc
    return delta < 0


def moon_illumination(d: date) -> float:
    m = ephem.Moon()
    m.compute(ephem.Date(d))
    return float(m.phase)            # 0..100 % illuminated


def is_waxing(d: date) -> bool:
    """Waxing = illumination rising (new → full). Folk rule: buy the waxing moon."""
    return moon_illumination(d + timedelta(days=1)) >= moon_illumination(d)


def _separation(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def chart_for(d: date) -> list[tuple[str, float, str, bool]]:
    """(body, ecliptic_lon, sign, retrograde) for each tracked body — the 星盤 as-of d."""
    out = []
    for name, cls in _BODIES.items():
        lon = _lon(cls, d)
        retro = name not in ("Sun", "Moon") and is_retrograde(cls, d)
        out.append((name, round(lon, 2), sign_of(lon), retro))
    return out


def aspects_for(d: date, orb: float = 6.0) -> list[str]:
    lons = {name: _lon(cls, d) for name, cls in _BODIES.items()}
    found: list[str] = []
    names = list(lons)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            sep = _separation(lons[names[i]], lons[names[j]])
            for asp, angle in _ASPECTS.items():
                if abs(sep - angle) <= orb:
                    found.append(f"{names[i]} {asp} {names[j]} ({sep:.1f}°)")
                    break
    return found


def benefic_to_sun(d: date, orb: float) -> bool:
    sun = _lon(ephem.Sun, d)
    for b in (ephem.Jupiter, ephem.Venus):
        sep = _separation(_lon(b, d), sun)
        if any(abs(sep - _ASPECTS[a]) <= orb for a in _BENEFIC):
            return True
    return False


def build_astro_state(dates: list[date], orb: float) -> dict[date, dict]:
    """Precompute the per-date deterministic state used by the signal + readings."""
    state: dict[date, dict] = {}
    for d in dates:
        state[d] = {
            "mercury_retro": is_retrograde(ephem.Mercury, d),
            "waxing": is_waxing(d),
            "moon_illum": round(moon_illumination(d), 1),
            "benefic": benefic_to_sun(d, orb),
        }
    return state


def make_want_long(spec, state: dict[date, dict]):
    def want_long(d: date) -> bool:
        s = state.get(d)
        if s is None:
            return spec.entry_signal == "buy_and_hold"
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "avoid_mercury_retrograde":
            return not s["mercury_retro"]
        if spec.entry_signal == "moon_phase_long":
            return s["waxing"]
        if spec.entry_signal == "benefic_aspect":
            return s["benefic"]
        return False

    return want_long


def astro_readings(d: date, orb: float) -> dict[str, float | str]:
    merc = is_retrograde(ephem.Mercury, d)
    illum = moon_illumination(d)
    wax = is_waxing(d)
    sun = _lon(ephem.Sun, d)
    phase = ("waxing" if wax else "waning") + (" (near full)" if illum > 90 else " (near new)" if illum < 10 else "")
    return {
        "astro_regime": "mercury_retrograde" if merc else "direct",
        "mercury_retrograde": "yes" if merc else "no",
        "moon_illumination_pct": round(illum, 1),
        "moon_phase": phase,
        "sun_sign": sign_of(sun),
        "n_aspects": float(len(aspects_for(d, orb))),
    }


def reasoning_chain(d: date, orb: float) -> list[str]:
    """The deterministic 星盤 read, step by step — printed in the UI."""
    chain: list[str] = []
    for name, lon, sign, retro in chart_for(d):
        zh = sign_zh(lon)
        chain.append(f"{name} {lon:.1f}° · {sign} ({zh}){' ℞ retrograde' if retro else ''}")
    illum = moon_illumination(d)
    chain.append(f"Moon {illum:.0f}% illuminated → {'waxing (new→full)' if is_waxing(d) else 'waning (full→new)'}")
    for a in aspects_for(d, orb)[:6]:
        chain.append(f"aspect: {a}")
    return chain


def readings_block(r: dict[str, float | str]) -> str:
    order = ["astro_regime", "mercury_retrograde", "moon_illumination_pct", "moon_phase", "sun_sign", "n_aspects"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)
