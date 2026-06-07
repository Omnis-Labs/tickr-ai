"""Tests for the congressional-trading agent. No network."""

from __future__ import annotations

from datetime import date

from task22_congress.pipeline.congress_data import _amount_bracket, _PTR_ROW, _txn_type
from task22_congress.pipeline.signals import congress_readings, make_want_long, split_dates
from task22_congress.schemas import CongressSpec, CongressTrade


def _t(disc, typ):
    return CongressTrade(disclosure_date=disc, txn_type=typ)


def test_amount_bracket_and_txn_type():
    assert _amount_bracket("$1,001 - $15,000") == (1001.0, 15000.0)
    assert _amount_bracket("$50,000") == (50000.0, 50000.0)
    assert _txn_type("S") == "sell" and _txn_type("P") == "buy" and _txn_type("E (partial)") == "exchange"


def test_ptr_row_regex_extracts_a_transaction():
    line = "Apple Inc (AAPL) [ST]  P  06/03/2024  06/20/2024  $1,001 - $15,000"
    m = _PTR_ROW.search(line)
    assert m and m.group(1) == "AAPL" and m.group(2) == "P" and m.group(3) == "06/03/2024"


def test_follow_buys_window_uses_disclosure_date():
    dates = {"buys": [date(2024, 1, 10)], "sells": []}
    wl = make_want_long(CongressSpec(entry_signal="follow_buys", holding_days=60), dates)
    assert not wl(date(2024, 1, 10))       # same day = not yet (strictly after disclosure)
    assert wl(date(2024, 2, 1))            # within the 60d drift window
    assert not wl(date(2024, 4, 1))        # window elapsed


def test_avoid_after_sells_window():
    dates = {"buys": [], "sells": [date(2024, 3, 1)]}
    wl = make_want_long(CongressSpec(entry_signal="avoid_after_sells", sell_window_days=60), dates)
    assert wl(date(2024, 2, 1))            # before the sell → long
    assert not wl(date(2024, 3, 20))       # inside avoid window → flat
    assert wl(date(2024, 6, 1))            # window passed → long again


def test_readings_regime_and_split():
    trades = [_t(date(2025, 3, 1), "buy"), _t(date(2025, 3, 5), "buy"), _t(date(2025, 3, 10), "sell")]
    d = split_dates(trades)
    assert d["buys"] == [date(2025, 3, 1), date(2025, 3, 5)] and d["sells"] == [date(2025, 3, 10)]
    r = congress_readings(trades, date(2025, 3, 20), "house_ptr_free (partial)")
    assert r["n_buys"] == 2.0 and r["n_sells"] == 1.0 and r["net_buy_minus_sell"] == 1.0
    assert r["congress_regime"] == "net_buying"


def test_no_trades_is_no_data():
    r = congress_readings([], date(2025, 1, 1), "fmp")
    assert r["congress_regime"] == "no_data" and r["n_trades"] == 0.0
