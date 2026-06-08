from datetime import date
from task35_jyotish.pipeline import jyotish as J
from task35_jyotish.schemas import JyotishSpec
def test_ayanamsa_near_24():
    assert 23 < J.ayanamsa(date(2000, 1, 1)) < 25
def test_dasha_periods_sum_120():
    assert sum(J.DASHA_YEARS) == 120 and len(J.DASHA_LORDS) == 9
def test_natal_nakshatra_range():
    n, frac = J.natal_nakshatra(date(1999, 1, 22))
    assert 0 <= n < 27 and 0 <= frac < 1
def test_mahadasha_lord_valid_and_deterministic():
    lord = J.mahadasha_lord(date(1999, 1, 22), date(2026, 6, 1))
    assert lord in J.DASHA_LORDS
    assert lord == J.mahadasha_lord(date(1999, 1, 22), date(2026, 6, 1))
def test_want_long_benefic():
    wl = J.make_want_long(JyotishSpec(entry_signal="benefic_dasha"), date(1999, 1, 22))
    for y in (2020, 2023, 2026):
        d = date(y, 6, 1)
        assert wl(d) == (J.mahadasha_lord(date(1999, 1, 22), d) in J.BENEFIC)
    assert J.make_want_long(JyotishSpec(entry_signal="buy_and_hold"), date(1999, 1, 22))(date(2024, 1, 1))
