"""Correctness tests for the insider agent — parse, aggregation, backtest. No network.

Properties that matter:
  * Form 4 XML parses to the right transactions + role flags; only open-market
    P/S are flagged discretionary.
  * flow_asof is lookahead-free: filings filed AFTER the decision date are invisible.
  * the backtest acts only after a signal's FILING date (no lookahead), tracks the
    benchmark for buy_and_hold, and stays flat when no insider buying ever fires.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task6_insider.pipeline.backtest import run_insider_backtest
from task6_insider.pipeline.forms import parse_form4_xml
from task6_insider.pipeline.signals import flow_asof, insider_readings_asof
from task6_insider.schemas import InsiderSpec, InsiderTxn, PricePoint


def _form4(owner: str, code: str, ad: str, shares: int, price: int, *,
           officer: bool = False, tdate: str = "2023-01-05") -> str:
    return f"""<ownershipDocument>
      <reportingOwner>
        <reportingOwnerId><rptOwnerName>{owner}</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship>
          <isOfficer>{1 if officer else 0}</isOfficer>
          <isDirector>1</isDirector>
          <officerTitle>{'CEO' if officer else ''}</officerTitle>
        </reportingOwnerRelationship>
      </reportingOwner>
      <nonDerivativeTable>
        <nonDerivativeTransaction>
          <transactionDate><value>{tdate}</value></transactionDate>
          <transactionCoding><transactionCode>{code}</transactionCode></transactionCoding>
          <transactionAmounts>
            <transactionShares><value>{shares}</value></transactionShares>
            <transactionPricePerShare><value>{price}</value></transactionPricePerShare>
            <transactionAcquiredDisposedCode><value>{ad}</value></transactionAcquiredDisposedCode>
          </transactionAmounts>
        </nonDerivativeTransaction>
      </nonDerivativeTable>
    </ownershipDocument>"""


def _series(closes: list[float], start: date = date(2023, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o,
                              high=max(o, c), low=min(o, c), close=c, volume=1_000.0))
    return pts


# --- parsing -----------------------------------------------------------------

def test_parse_open_market_buy():
    txns = parse_form4_xml(_form4("Jane Insider", "P", "A", 1000, 50, officer=True), date(2023, 1, 7))
    assert len(txns) == 1
    t = txns[0]
    assert t.is_open_market_buy and not t.is_open_market_sale
    assert t.is_officer and t.officer_title == "CEO"
    assert t.value_usd == 50_000.0
    assert t.filing_date == date(2023, 1, 7) and t.transaction_date == date(2023, 1, 5)


def test_grant_is_not_a_discretionary_buy():
    # code A (grant), acquired — must NOT count as an open-market buy
    txns = parse_form4_xml(_form4("Jane", "A", "A", 1000, 0), date(2023, 1, 7))
    assert len(txns) == 1 and not txns[0].is_open_market_buy


# --- aggregation + lookahead -------------------------------------------------

def test_flow_asof_is_lookahead_free():
    txns = [
        InsiderTxn(filing_date=date(2023, 1, 10), transaction_date=date(2023, 1, 9),
                   code="P", shares=100, price=10, acquired_disposed="A", owner_name="A"),
        InsiderTxn(filing_date=date(2023, 2, 20), transaction_date=date(2023, 2, 19),
                   code="P", shares=200, price=10, acquired_disposed="A", owner_name="B"),
    ]
    # as-of Jan 15: only the Jan 10 filing is visible
    f = flow_asof(txns, date(2023, 1, 15), lookback_days=90)
    assert f["buy_count"] == 1 and f["distinct_buyers"] == 1 and f["net_value_usd"] == 1000.0
    # as-of Mar 1: both visible
    f2 = flow_asof(txns, date(2023, 3, 1), lookback_days=90)
    assert f2["buy_count"] == 2 and f2["distinct_buyers"] == 2 and f2["net_value_usd"] == 3000.0


def test_readings_regime_cluster():
    txns = [
        InsiderTxn(filing_date=date(2023, 1, 10), transaction_date=date(2023, 1, 9),
                   code="P", shares=100, price=10, acquired_disposed="A", owner_name="A", is_officer=True),
        InsiderTxn(filing_date=date(2023, 1, 12), transaction_date=date(2023, 1, 11),
                   code="P", shares=100, price=10, acquired_disposed="A", owner_name="B"),
    ]
    r = insider_readings_asof(txns, date(2023, 1, 20), lookback_days=90)
    assert r["insider_regime"] == "cluster_buying" and r["distinct_buyers"] == 2.0


# --- backtest ----------------------------------------------------------------

def test_buy_and_hold_tracks_benchmark_minus_costs():
    prices = _series([100, 101, 102, 103, 104, 105])
    spec = InsiderSpec(entry_signal="buy_and_hold", exit_signal="hold")
    r = run_insider_backtest(prices, [], spec, start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.benchmark_return_pct == pytest.approx(5.0, abs=0.01)
    assert 0 < r.metrics.total_return_pct < r.metrics.benchmark_return_pct


def test_no_insider_buys_means_flat():
    prices = _series([100, 90, 120, 80, 130])
    spec = InsiderSpec(entry_signal="cluster_buy", exit_signal="time_exit", min_distinct_buyers=2)
    r = run_insider_backtest(prices, [], spec, start=prices[0].date)
    assert r.metrics.n_trades == 0 and r.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)


def test_cluster_buy_enters_only_after_filing_date():
    prices = _series([100, 100, 100, 100, 100, 110, 120, 130, 140, 150])
    sig_day = prices[5].date  # two insiders file on bar 5
    txns = [
        InsiderTxn(filing_date=sig_day, transaction_date=sig_day, code="P", shares=100,
                   price=100, acquired_disposed="A", owner_name="A", is_officer=True),
        InsiderTxn(filing_date=sig_day, transaction_date=sig_day, code="P", shares=100,
                   price=100, acquired_disposed="A", owner_name="B"),
    ]
    spec = InsiderSpec(entry_signal="cluster_buy", exit_signal="time_exit",
                       min_distinct_buyers=2, holding_days=999, lookback_days=90)
    r = run_insider_backtest(prices, txns, spec, start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1
    # signal known at close of bar 5 → fills no earlier than bar 6's open
    assert all(t.entry_date > sig_day for t in r.trades)
