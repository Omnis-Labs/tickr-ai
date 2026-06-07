"""Tests for the buyback agent. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task15_buyback.pipeline.backtest import run_buyback_backtest
from task15_buyback.pipeline.signals import shares_yoy_asof
from task15_buyback.schemas import BuybackSpec, PricePoint, SharePoint


def test_shares_yoy_detects_reduction():
    shares = [
        SharePoint(end=date(2024, 3, 31), filed=date(2024, 4, 20), fy=2024, fp="Q1", diluted_shares=1000),
        SharePoint(end=date(2025, 3, 31), filed=date(2025, 4, 20), fy=2025, fp="Q1", diluted_shares=950),
    ]
    m = shares_yoy_asof(shares, date(2025, 5, 1))
    assert m["yoy_change_pct"] == pytest.approx(-5.0) and m["has_yoy"]


def _series(closes, start=date(2024, 1, 1)):
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o, high=max(o, c), low=min(o, c), close=c, volume=1e6))
    return pts


def test_buyback_enters_after_reduction_filing():
    prices = _series([100] * 30 + [110, 120, 130, 140, 150, 160])
    filing = prices[20].date
    shares = [
        SharePoint(end=date(2023, 3, 31), filed=prices[1].date, fy=2023, fp="Q1", diluted_shares=1000),
        SharePoint(end=date(2024, 3, 31), filed=filing, fy=2024, fp="Q1", diluted_shares=950),  # -5%
    ]
    spec = BuybackSpec(entry_signal="buyback", exit_signal="hold", reduction_threshold_pct=1.0, holding_days=999)
    r = run_buyback_backtest(prices, shares, spec, start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1
    assert all(t.entry_date > filing for t in r.trades)


def test_dilution_means_flat():
    prices = _series([100, 90, 120, 80, 130])
    shares = [
        SharePoint(end=date(2023, 3, 31), filed=prices[0].date, fy=2023, fp="Q1", diluted_shares=1000),
        SharePoint(end=date(2024, 3, 31), filed=prices[1].date, fy=2024, fp="Q1", diluted_shares=1100),  # +10% dilution
    ]
    spec = BuybackSpec(entry_signal="buyback", reduction_threshold_pct=1.0)
    r = run_buyback_backtest(prices, shares, spec, start=prices[0].date)
    assert r.metrics.n_trades == 0
