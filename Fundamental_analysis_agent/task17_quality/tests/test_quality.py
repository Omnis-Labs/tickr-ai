"""Tests for the fundamental-quality agent. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task11_fundamentals_trend.pipeline.companyfacts import annual_series, instant_series
from task17_quality.pipeline.backtest import run_factor_backtest
from task17_quality.pipeline.factors import build_bundle, metrics_asof, wants_long
from task17_quality.schemas import PricePoint, QualitySpec


def _annual(tag, vals, unit="USD"):
    # vals = list of (end_iso, val), each ~365-day period filed ~3 months later
    return {tag: {"units": {unit: [
        {"start": f"{int(e[:4]) - 1}{e[4:]}", "end": e, "val": v, "form": "10-K",
         "fy": int(e[:4]), "fp": "FY", "filed": e}  # filed≈end for the test
        for e, v in vals]}}}


def _instant(tag, vals):
    return {tag: {"units": {"USD": [{"end": e, "val": v, "form": "10-K", "filed": e} for e, v in vals]}}}


def test_annual_and_instant_extractors():
    g = _annual("NetIncomeLoss", [("2024-12-31", 100), ("2025-12-31", 130)])
    a = annual_series(g, ["NetIncomeLoss"])
    assert a[date(2025, 12, 31)][1] == 130.0
    gi = _instant("Assets", [("2024-12-31", 1000), ("2025-12-31", 1100)])
    inst = instant_series(gi, ["Assets"])
    assert inst[date(2025, 12, 31)][1] == 1100.0 and date(2025, 12, 31) in inst


def _full_gaap(improving=True):
    # two fiscal years; second year strong (high F-score) or weak
    g = {}
    ni = [("2024-12-31", 100), ("2025-12-31", 150 if improving else 40)]
    cfo = [("2024-12-31", 120), ("2025-12-31", 200 if improving else 30)]  # CFO>NI (good accruals) when improving
    rev = [("2024-12-31", 1000), ("2025-12-31", 1200)]
    gp = [("2024-12-31", 300), ("2025-12-31", 400 if improving else 250)]   # gross-margin Δ
    sh = [("2024-12-31", 500), ("2025-12-31", 495 if improving else 540)]
    for tag, vals, unit in [("NetIncomeLoss", ni, "USD"),
                            ("NetCashProvidedByUsedInOperatingActivities", cfo, "USD"),
                            ("GrossProfit", gp, "USD"),
                            ("RevenueFromContractWithCustomerExcludingAssessedTax", rev, "USD"),
                            ("WeightedAverageNumberOfDilutedSharesOutstanding", sh, "shares")]:
        g.update(_annual(tag, vals, unit))
    g.update(_instant("Assets", [("2024-12-31", 2000), ("2025-12-31", 2100 if improving else 2600)]))
    g.update(_instant("AssetsCurrent", [("2024-12-31", 800), ("2025-12-31", 950 if improving else 700)]))
    g.update(_instant("LiabilitiesCurrent", [("2024-12-31", 700), ("2025-12-31", 650 if improving else 800)]))
    g.update(_instant("LongTermDebtNoncurrent", [("2024-12-31", 500), ("2025-12-31", 400 if improving else 700)]))
    return g


def test_f_score_high_for_improving_company():
    m = metrics_asof(build_bundle(_full_gaap(improving=True)), date(2026, 3, 1))
    assert m["f_score"] >= 7
    assert m["asset_growth_pct"] == pytest.approx(5.0)   # 2100/2000 - 1


def test_f_score_low_for_weak_company():
    m = metrics_asof(build_bundle(_full_gaap(improving=False)), date(2026, 3, 1))
    assert m["f_score"] <= 4


def _series(closes, start=date(2023, 1, 1)):
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o, high=max(o, c), low=min(o, c), close=c, volume=1e6))
    return pts


def test_factor_backtest_gates_on_want_long():
    prices = _series([100 + i for i in range(40)])
    cutoff = prices[20].date
    r = run_factor_backtest(prices, lambda d: d >= cutoff, start=prices[0].date, exit_mode="deteriorating", transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1 and all(t.entry_date > cutoff for t in r.trades)
