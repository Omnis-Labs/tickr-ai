"""Tests for the corporate-events agent. No network."""

from __future__ import annotations

from datetime import date, timedelta

from task18_events.pipeline.events import event_readings, make_want_long
from task18_events.schemas import EventRecord, EventSpec


def test_activist_drift_window():
    bundle = {"activist": [date(2024, 1, 10)], "redflags": []}
    spec = EventSpec(entry_signal="activist_drift", holding_days=60)
    wl = make_want_long(spec, bundle)
    assert not wl(date(2024, 1, 10))           # same day = not yet (strictly after)
    assert wl(date(2024, 2, 1))                # within 60d
    assert not wl(date(2024, 5, 1))            # past the drift window
    assert not wl(date(2023, 12, 1))           # before the 13D


def test_avoid_redflags_window():
    bundle = {"activist": [], "redflags": [date(2024, 3, 1)]}
    spec = EventSpec(entry_signal="avoid_redflags", redflag_window_days=60)
    wl = make_want_long(spec, bundle)
    assert wl(date(2024, 2, 1))                # before the red flag → long
    assert not wl(date(2024, 3, 20))           # inside the avoid window → flat
    assert wl(date(2024, 6, 1))                # window passed → long again


def test_buy_and_hold_always_long():
    wl = make_want_long(EventSpec(entry_signal="buy_and_hold"), {"activist": [], "redflags": []})
    assert wl(date(2024, 1, 1)) and wl(date(2025, 1, 1))


def test_event_readings_regime():
    recs = [
        EventRecord(date=date(2025, 3, 1), kind="activist", polarity="positive"),
        EventRecord(date=date(2025, 4, 1), kind="dilution", polarity="negative"),
    ]
    bundle = {"activist": [date(2025, 3, 1)], "redflags": [date(2025, 4, 1)]}
    r = event_readings(recs, bundle, date(2025, 5, 1))
    assert r["n_activist_13d"] == 1.0 and r["n_red_flags"] == 1.0
    assert r["event_regime"] in ("activist_active", "red_flag_recent")
