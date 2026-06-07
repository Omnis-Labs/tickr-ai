"""Tests for the financial-astrology placebo engine. No network (ephem is offline)."""

from __future__ import annotations

from datetime import date

from task25_astro.pipeline import astro
from task25_astro.schemas import AstroSpec


def test_chart_is_deterministic_and_offline():
    # same date → identical chart, twice (pure function of the date)
    a = astro.chart_for(date(2024, 1, 2))
    b = astro.chart_for(date(2024, 1, 2))
    assert a == b
    bodies = {row[0] for row in a}
    assert {"Sun", "Moon", "Mercury", "Jupiter"} <= bodies
    for _body, lon, sign, _retro in a:
        assert 0.0 <= lon < 360.0 and sign in astro._SIGNS


def test_sign_boundaries():
    assert astro.sign_of(0.0) == "Aries" and astro.sign_of(95.0) == "Cancer" and astro.sign_of(359.9) == "Pisces"


def test_moon_phase_waxing_is_boolean_and_consistent():
    illum = astro.moon_illumination(date(2024, 1, 2))
    assert 0.0 <= illum <= 100.0
    assert isinstance(astro.is_waxing(date(2024, 1, 2)), bool)


def test_want_long_respects_signal_and_state():
    dates = [date(2024, 3, 1), date(2024, 3, 2)]
    state = {
        dates[0]: {"mercury_retro": True, "waxing": True, "moon_illum": 50.0, "benefic": False},
        dates[1]: {"mercury_retro": False, "waxing": False, "moon_illum": 50.0, "benefic": True},
    }
    wl_merc = astro.make_want_long(AstroSpec(entry_signal="avoid_mercury_retrograde"), state)
    assert not wl_merc(dates[0]) and wl_merc(dates[1])
    wl_moon = astro.make_want_long(AstroSpec(entry_signal="moon_phase_long"), state)
    assert wl_moon(dates[0]) and not wl_moon(dates[1])
    wl_bh = astro.make_want_long(AstroSpec(entry_signal="buy_and_hold"), state)
    assert wl_bh(dates[0]) and wl_bh(dates[1])


def test_reasoning_chain_lists_bodies():
    chain = astro.reasoning_chain(date(2024, 1, 2), 6.0)
    assert any("Sun" in line for line in chain) and any("Moon" in line for line in chain)
