"""Jyotiṣa (Vedic / Hindu sidereal astrology) deterministic engine. Offline, lookahead-free.

Genuinely computable (unlike the 三式 simplifications): SIDEREAL positions = tropical
(ephem) − ayanāṃśa (Lahiri), the 9 grahas incl. Rāhu/Ketu (lunar nodes), the natal
Moon's nakṣatra, and the **Vimśottarī Daśā** — the 120-year planetary-period cycle that
is the heart of Vedic timing. The signal rides the current Mahādaśā lord:
  benefic daśā (Jupiter / Venus / Mercury / Moon)  →  favourable
  malefic daśā (Saturn / Mars / Rāhu / Ketu / Sun)  →  unfavourable

All a pure function of the date. ⚠️ CONTROL / PLACEBO — no economic mechanism.
"""

from __future__ import annotations

import math
from datetime import date

import ephem

GRAHAS = {"Sun": ephem.Sun, "Moon": ephem.Moon, "Mars": ephem.Mars, "Mercury": ephem.Mercury,
          "Jupiter": ephem.Jupiter, "Venus": ephem.Venus, "Saturn": ephem.Saturn}
RASHI = ["Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya",
         "Tula", "Vrischika", "Dhanu", "Makara", "Kumbha", "Meena"]
NAKSHATRA = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu",
             "Pushya", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta",
             "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha", "Mula", "Purva Ashadha",
             "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada",
             "Uttara Bhadrapada", "Revati"]
# Vimśottarī sequence + period years (total 120)
DASHA_LORDS = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu", "Jupiter", "Saturn", "Mercury"]
DASHA_YEARS = [7, 20, 6, 10, 7, 18, 16, 19, 17]
BENEFIC = {"Jupiter", "Venus", "Mercury", "Moon"}
_NAK_SIZE = 360.0 / 27.0


def _jd(d: date) -> float:
    return ephem.julian_date(ephem.Date(d))


def ayanamsa(d: date) -> float:
    """Lahiri ayanāṃśa ≈ 23.853° at J2000 + ~50.29″/yr precession."""
    return 23.853 + (_jd(d) - 2451545.0) / 365.25 * (50.2719 / 3600.0)


def _trop_lon(body_cls, d: date) -> float:
    b = body_cls(); b.compute(ephem.Date(d))
    return math.degrees(ephem.Ecliptic(b).lon) % 360.0


def _rahu_lon(d: date) -> float:
    t = (_jd(d) - 2451545.0) / 36525.0
    return (125.0445 - 1934.1363 * t) % 360.0       # mean ascending node (tropical)


def sidereal_lon(body: str, d: date) -> float:
    ayan = ayanamsa(d)
    if body == "Rahu":
        return (_rahu_lon(d) - ayan) % 360.0
    if body == "Ketu":
        return (_rahu_lon(d) + 180.0 - ayan) % 360.0
    return (_trop_lon(GRAHAS[body], d) - ayan) % 360.0


def chart(d: date) -> list[tuple[str, float, str]]:
    """(graha, sidereal_lon, rashi) for the 9 grahas."""
    out = [(b, round(sidereal_lon(b, d), 2), RASHI[int(sidereal_lon(b, d) // 30) % 12])
           for b in GRAHAS]
    for nd in ("Rahu", "Ketu"):
        out.append((nd, round(sidereal_lon(nd, d), 2), RASHI[int(sidereal_lon(nd, d) // 30) % 12]))
    return out


def natal_nakshatra(listing: date) -> tuple[int, float]:
    """(nakshatra index 0-26, fraction elapsed within it) for the natal Moon."""
    moon = sidereal_lon("Moon", listing)
    n = int(moon // _NAK_SIZE) % 27
    frac = (moon % _NAK_SIZE) / _NAK_SIZE
    return n, frac


def mahadasha_lord(listing: date, on: date) -> str:
    """The Vimśottarī Mahādaśā lord active on `on`, from the natal Moon nakṣatra."""
    n, frac = natal_nakshatra(listing)
    start = n % 9
    elapsed = (_jd(on) - _jd(listing)) / 365.25
    # balance of the birth daśā
    remaining = (1.0 - frac) * DASHA_YEARS[start]
    if elapsed < remaining:
        return DASHA_LORDS[start]
    elapsed -= remaining
    i = (start + 1) % 9
    while elapsed >= DASHA_YEARS[i]:
        elapsed -= DASHA_YEARS[i]
        i = (i + 1) % 9
    return DASHA_LORDS[i]


def make_want_long(spec, listing: date):
    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        lord = mahadasha_lord(listing, d)
        if spec.entry_signal == "benefic_dasha":
            return lord in BENEFIC
        if spec.entry_signal == "avoid_malefic_dasha":
            return lord in BENEFIC
        return False
    return want_long


def jyotish_readings(listing: date, as_of: date) -> dict[str, float | str]:
    n, _frac = natal_nakshatra(listing)
    lord = mahadasha_lord(listing, as_of)
    moon_rashi = RASHI[int(sidereal_lon("Moon", listing) // 30) % 12]
    return {
        "jyotish_regime": "benefic_dasha" if lord in BENEFIC else "malefic_dasha",
        "moon_nakshatra": NAKSHATRA[n],
        "moon_rashi": moon_rashi,
        "mahadasha_lord": lord,
        "dasha_nature": "benefic" if lord in BENEFIC else "malefic",
        "ayanamsa_deg": round(ayanamsa(as_of), 2),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["jyotish_regime", "moon_nakshatra", "moon_rashi", "mahadasha_lord", "dasha_nature", "ayanamsa_deg"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def reasoning_chain(listing: date, as_of: date) -> list[str]:
    n, frac = natal_nakshatra(listing)
    lord = mahadasha_lord(listing, as_of)
    return [
        f"Birth chart (listing {listing.isoformat()}): sidereal = tropical − Lahiri ayanāṃśa ({ayanamsa(as_of):.1f}°).",
        f"Natal Moon in nakṣatra {NAKSHATRA[n]} ({frac*100:.0f}% elapsed) → starts the Vimśottarī sequence at its lord.",
        f"Walking the 120-yr Vimśottarī cycle to {as_of.isoformat()}: current Mahādaśā lord = {lord}.",
        f"{lord} is a {'benefic' if lord in BENEFIC else 'malefic'} (benefics: Jupiter/Venus/Mercury/Moon).",
        f"Signal: {'hold (benefic daśā)' if lord in BENEFIC else 'flat (malefic daśā)'}.",
    ]
