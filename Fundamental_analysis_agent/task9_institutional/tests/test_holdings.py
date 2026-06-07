"""Correctness tests for the 13F agent — parse, aggregation, backtest. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task9_institutional.pipeline.backtest import run_institutional_backtest
from task9_institutional.pipeline.funds import _matches, _parse_infotable, issuer_core
from task9_institutional.pipeline.holdings import (
    build_series,
    fund_summaries,
    shares_asof,
)
from task9_institutional.schemas import FundHolding, InstitutionalSpec, PricePoint

_XML = """<informationTable>
  <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><value>1000</value>
    <shrsOrPrnAmt><sshPrnamt>500</sshPrnamt></shrsOrPrnAmt></infoTable>
  <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><value>2000</value>
    <shrsOrPrnAmt><sshPrnamt>300</sshPrnamt></shrsOrPrnAmt></infoTable>
  <infoTable><nameOfIssuer>MICROSOFT CORP</nameOfIssuer><value>9</value>
    <shrsOrPrnAmt><sshPrnamt>9</sshPrnamt></shrsOrPrnAmt></infoTable>
</informationTable>"""


def _series_prices(closes: list[float], start: date = date(2023, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o,
                              high=max(o, c), low=min(o, c), close=c, volume=1_000.0))
    return pts


# --- name matching + parse ---------------------------------------------------

def test_issuer_core_skips_suffixes():
    assert issuer_core("Apple Inc.") == "APPLE"
    assert issuer_core("The Goldman Sachs Group, Inc.") == "GOLDMAN"


def test_matches_startswith_core():
    assert _matches("APPLE INC", "APPLE")
    assert not _matches("MICROSOFT CORP", "APPLE")


def test_parse_infotable_sums_rows_for_issuer():
    shares, value = _parse_infotable(_XML, "APPLE")
    assert shares == pytest.approx(800.0)            # 500 + 300
    assert value == pytest.approx(3_000_000.0)       # (1000 + 2000) * 1000


# --- aggregation timeline ----------------------------------------------------

def test_shares_asof_is_a_step_function_per_fund():
    hs = [
        FundHolding(filing_date=date(2023, 2, 1), fund_name="A", shares=100),
        FundHolding(filing_date=date(2023, 5, 1), fund_name="A", shares=250),
        FundHolding(filing_date=date(2023, 3, 1), fund_name="B", shares=50),
    ]
    s = build_series(hs)
    assert shares_asof(s, date(2023, 1, 1)) == 0.0           # before any filing
    assert shares_asof(s, date(2023, 2, 15)) == 100.0        # only A
    assert shares_asof(s, date(2023, 4, 1)) == 150.0         # A(100) + B(50)
    assert shares_asof(s, date(2023, 6, 1)) == 300.0         # A(250) + B(50)


def test_fund_summaries_detects_added():
    hs = [
        FundHolding(filing_date=date(2023, 2, 1), fund_name="A", shares=100),
        FundHolding(filing_date=date(2023, 5, 1), fund_name="A", shares=250),
    ]
    sums = fund_summaries(build_series(hs), date(2023, 6, 1))
    assert sums[0].fund_name == "A" and sums[0].change == "added"


# --- backtest ----------------------------------------------------------------

def test_accumulating_goes_long_after_filing():
    prices = _series_prices([100] * 40 + [110, 120, 130, 140, 150, 160, 170, 180])
    d0 = prices[0].date
    # holding doubles at bar 20 (a later filing) → accumulating vs lookback
    hs = [
        FundHolding(filing_date=d0 + timedelta(days=2), fund_name="A", shares=100),
        FundHolding(filing_date=prices[20].date, fund_name="A", shares=300),
    ]
    spec = InstitutionalSpec(entry_signal="accumulating", exit_signal="hold",
                             accumulation_lookback_days=10, holding_days=999)
    r = run_institutional_backtest(prices, hs, spec, start=d0, transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1
    # lookahead-safe: never acts before the EARLIEST 13F filing is public
    first_filing = min(h.filing_date for h in hs)
    assert all(t.entry_date > first_filing for t in r.trades)


def test_no_tracked_holders_means_flat():
    prices = _series_prices([100, 90, 120, 80, 130, 95, 110])
    spec = InstitutionalSpec(entry_signal="any_holding", exit_signal="hold")
    r = run_institutional_backtest(prices, [], spec, start=prices[0].date)
    assert r.metrics.n_trades == 0 and r.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)
