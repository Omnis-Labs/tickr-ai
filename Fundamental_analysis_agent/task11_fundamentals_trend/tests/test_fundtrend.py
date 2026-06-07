"""Correctness tests for the fundamentals-trend agent — XBRL extract, YoY, backtest. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task11_fundamentals_trend.pipeline.backtest import run_fundtrend_backtest
from task11_fundamentals_trend.pipeline.companyfacts import extract_quarters
from task11_fundamentals_trend.pipeline.signals import metrics_asof
from task11_fundamentals_trend.schemas import FundTrendSpec, PricePoint, QuarterPoint


def _rev_fact(start, end, val, fy, fp, filed):
    return {"start": start, "end": end, "val": val, "fy": fy, "fp": fp, "form": "10-Q", "filed": filed}


def test_extract_quarters_keeps_quarterly_and_skips_annual():
    gaap = {"RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
        _rev_fact("2024-01-01", "2024-03-31", 100, 2024, "Q1", "2024-04-20"),  # ~90d → keep
        _rev_fact("2024-01-01", "2024-12-31", 450, 2024, "FY", "2025-02-01"),  # ~365d → skip
        _rev_fact("2025-01-01", "2025-03-31", 120, 2025, "Q1", "2025-04-20"),  # ~90d → keep
    ]}}}
    qs = extract_quarters(gaap)
    assert [q.revenue for q in qs] == [100.0, 120.0]
    assert all(q.fp == "Q1" for q in qs)


def test_metrics_asof_computes_yoy_growth():
    qs = [
        QuarterPoint(end=date(2024, 3, 31), filed=date(2024, 4, 20), fy=2024, fp="Q1",
                     revenue=100, gross_profit=40, net_income=20),
        QuarterPoint(end=date(2025, 3, 31), filed=date(2025, 4, 20), fy=2025, fp="Q1",
                     revenue=120, gross_profit=54, net_income=30),
    ]
    m = metrics_asof(qs, date(2025, 5, 1))
    assert m["revenue_yoy_pct"] == pytest.approx(20.0)         # 120/100 - 1
    assert m["earnings_yoy_pct"] == pytest.approx(50.0)        # 30/20 - 1
    assert m["gross_margin_pct"] == pytest.approx(45.0)        # 54/120
    assert m["margin_yoy_change_pp"] == pytest.approx(5.0)     # 45% - 40%


def test_metrics_asof_is_lookahead_free():
    qs = [
        QuarterPoint(end=date(2024, 3, 31), filed=date(2024, 4, 20), fy=2024, fp="Q1", revenue=100),
        QuarterPoint(end=date(2025, 3, 31), filed=date(2025, 4, 20), fy=2025, fp="Q1", revenue=120),
    ]
    # before the 2025 filing, only the 2024 quarter is visible → no YoY yet
    m = metrics_asof(qs, date(2025, 1, 1))
    assert m["fy"] == 2024 and not m["has_yoy"]


def _series(closes, start=date(2024, 1, 1)):
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o,
                              high=max(o, c), low=min(o, c), close=c, volume=1_000.0))
    return pts


def test_backtest_enters_after_improving_filing():
    prices = _series([100] * 30 + [110, 120, 130, 140, 150, 160])
    filing = prices[20].date
    qs = [
        QuarterPoint(end=date(2023, 3, 31), filed=prices[1].date, fy=2023, fp="Q1", revenue=100),
        QuarterPoint(end=date(2024, 3, 31), filed=filing, fy=2024, fp="Q1", revenue=130),  # +30% YoY
    ]
    spec = FundTrendSpec(entry_signal="revenue_growth", exit_signal="hold",
                         revenue_growth_threshold_pct=10.0, holding_days=999)
    r = run_fundtrend_backtest(prices, qs, spec, start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1
    assert all(t.entry_date > filing for t in r.trades)  # acts only after the improving filing


def test_backtest_flat_when_no_growth():
    prices = _series([100, 90, 120, 80, 130])
    qs = [
        QuarterPoint(end=date(2023, 3, 31), filed=prices[0].date, fy=2023, fp="Q1", revenue=100),
        QuarterPoint(end=date(2024, 3, 31), filed=prices[1].date, fy=2024, fp="Q1", revenue=80),  # -20%
    ]
    spec = FundTrendSpec(entry_signal="revenue_growth", revenue_growth_threshold_pct=0.0)
    r = run_fundtrend_backtest(prices, qs, spec, start=prices[0].date)
    assert r.metrics.n_trades == 0
