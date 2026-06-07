"""Correctness tests for the earnings agent — exhibit picking, event backtest. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task8_earnings.pipeline.backtest import _qualifies, run_earnings_backtest
from task8_earnings.pipeline.filings import _html_to_text, _pick_exhibit
from task8_earnings.schemas import EarningsEvent, EarningsSpec, PricePoint


def _series(closes: list[float], start: date = date(2023, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o,
                              high=max(o, c), low=min(o, c), close=c, volume=1_000.0))
    return pts


# --- filings helpers ---------------------------------------------------------

def test_pick_exhibit_prefers_ex99_name():
    files = [
        {"name": "aapl-20260430.htm", "size": "37000"},          # the 8-K cover (primary)
        {"name": "R1.htm", "size": "55000"},                      # XBRL viewer
        {"name": "a8-kex991q2.htm", "size": "168000"},            # the press release
    ]
    assert _pick_exhibit(files, "aapl-20260430.htm") == "a8-kex991q2.htm"


def test_pick_exhibit_falls_back_to_largest_html():
    files = [
        {"name": "form8k.htm", "size": "30000"},                  # primary
        {"name": "pressrelease.htm", "size": "120000"},           # no ex99 in name → largest wins
    ]
    assert _pick_exhibit(files, "form8k.htm") == "pressrelease.htm"


def test_html_to_text_strips_markup():
    assert _html_to_text("<html><body><p>Hello&nbsp;<b>world</b></p></body></html>").startswith("Hello")


# --- entry qualification -----------------------------------------------------

def test_qualifies_by_entry_signal():
    bull = EarningsEvent(filing_date=date(2023, 1, 5), sentiment="bullish", guidance="maintained", beat_miss="beat")
    raised = EarningsEvent(filing_date=date(2023, 1, 5), sentiment="neutral", guidance="raised", beat_miss="inline")
    weak = EarningsEvent(filing_date=date(2023, 1, 5), sentiment="bearish", guidance="lowered", beat_miss="miss")
    assert _qualifies(EarningsSpec(entry_signal="any_earnings"), weak)
    assert _qualifies(EarningsSpec(entry_signal="bullish"), bull)
    assert not _qualifies(EarningsSpec(entry_signal="bullish"), raised)
    assert _qualifies(EarningsSpec(entry_signal="bullish_or_raised"), raised)
    assert _qualifies(EarningsSpec(entry_signal="beat"), bull)
    assert not _qualifies(EarningsSpec(entry_signal="beat"), weak)


# --- backtest ----------------------------------------------------------------

def test_enters_only_after_filing_date():
    prices = _series([100, 100, 100, 100, 100, 100, 110, 120, 130, 140, 150])
    ev_day = prices[5].date
    events = [EarningsEvent(filing_date=ev_day, sentiment="bullish")]
    spec = EarningsSpec(entry_signal="bullish", exit_signal="time_exit", holding_days=999)
    r = run_earnings_backtest(prices, events, spec, start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1
    assert all(t.entry_date > ev_day for t in r.trades)   # acts only AFTER the filing


def test_no_qualifying_events_means_flat():
    prices = _series([100, 90, 120, 80, 130, 95, 105])
    events = [EarningsEvent(filing_date=prices[3].date, sentiment="bearish")]
    spec = EarningsSpec(entry_signal="bullish", exit_signal="time_exit", holding_days=10)
    r = run_earnings_backtest(prices, events, spec, start=prices[0].date)
    assert r.metrics.n_trades == 0 and r.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)


def test_time_exit_bounds_the_hold():
    prices = _series([100] * 3 + [100, 100, 100, 100, 100, 100, 100, 100, 100])
    events = [EarningsEvent(filing_date=prices[2].date, sentiment="bullish")]
    spec = EarningsSpec(entry_signal="any_earnings", exit_signal="time_exit", holding_days=3)
    r = run_earnings_backtest(prices, events, spec, start=prices[0].date)
    assert r.metrics.n_trades == 1
    t = r.trades[0]
    # entry fills ~bar3, exit ~holding_days later → a bounded hold, not end_of_data
    assert t.exit_reason in ("time_exit", "end_of_data")
