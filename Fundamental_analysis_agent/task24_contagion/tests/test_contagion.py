"""Tests for the earnings-contagion agent. No network."""

from __future__ import annotations

from datetime import date

from task8_earnings.schemas import EarningsEvent
from task24_contagion.pipeline.contagion import (
    contagion_readings, event_polarity, make_want_long, split_dates,
)
from task24_contagion.schemas import ContagionSpec


def _ev(d, sentiment="neutral", beat="unknown", guidance="none"):
    return EarningsEvent(filing_date=d, sentiment=sentiment, beat_miss=beat, guidance=guidance)


def test_event_polarity_majority_vote():
    assert event_polarity(_ev(date(2024, 1, 1), "bullish", "beat", "raised")) == "positive"
    assert event_polarity(_ev(date(2024, 1, 1), "bearish", "miss", "lowered")) == "negative"
    assert event_polarity(_ev(date(2024, 1, 1), "bullish", "miss", "none")) == "neutral"  # 1 vs 1 → neutral


def test_split_dates():
    evs = [_ev(date(2024, 1, 1), "bullish", "beat"), _ev(date(2024, 4, 1), "bearish", "miss")]
    d = split_dates(evs)
    assert d["positive"] == [date(2024, 1, 1)] and d["negative"] == [date(2024, 4, 1)]


def test_follow_positive_window():
    dates = {"positive": [date(2024, 1, 10)], "negative": []}
    wl = make_want_long(ContagionSpec(entry_signal="follow_positive", drift_days=10), dates)
    assert not wl(date(2024, 1, 10))         # same day = not yet
    assert wl(date(2024, 1, 15))             # within the 10d read-across window
    assert not wl(date(2024, 1, 25))         # window elapsed


def test_avoid_after_negative_window():
    dates = {"positive": [], "negative": [date(2024, 3, 1)]}
    wl = make_want_long(ContagionSpec(entry_signal="avoid_after_negative", drift_days=10), dates)
    assert wl(date(2024, 2, 25))             # before → long
    assert not wl(date(2024, 3, 5))          # inside avoid window → flat
    assert wl(date(2024, 3, 20))             # window passed → long


def test_readings_regime():
    evs = [_ev(date(2025, 2, 1), "bullish", "beat", "raised")]
    r = contagion_readings(evs, split_dates(evs), date(2025, 2, 20), "AVGO")
    assert r["n_positive"] == 1.0 and r["bellwether"] == "AVGO"
    assert r["contagion_regime"] == "last_positive"
