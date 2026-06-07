"""Correctness tests for portfolio sizing + the portfolio backtest. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task10_portfolio.pipeline.backtest import run_portfolio_backtest
from task10_portfolio.pipeline.sizing import (
    apply_max_weight,
    equal_weights,
    inverse_vol_weights,
    risk_parity_weights,
    scale_gross_and_vol,
    signal_proportional_weights,
    target_weights,
)


# --- sizing math -------------------------------------------------------------

def test_equal_weights():
    assert equal_weights(4) == pytest.approx([0.25] * 4)


def test_inverse_vol_down_weights_volatile_names():
    w = inverse_vol_weights([0.1, 0.2])      # half the vol → twice the weight
    assert w == pytest.approx([2 / 3, 1 / 3])
    assert sum(w) == pytest.approx(1.0)


def test_signal_proportional():
    w = signal_proportional_weights([1.0, 0.5, 0.25])
    assert w == pytest.approx([1 / 1.75, 0.5 / 1.75, 0.25 / 1.75])


def test_max_weight_caps_and_redistributes():
    w = apply_max_weight([0.6, 0.3, 0.1], 0.4)
    assert max(w) <= 0.4 + 1e-9
    assert sum(w) == pytest.approx(1.0)


def test_risk_parity_matches_inverse_vol_when_uncorrelated():
    cov = [[0.04, 0.0], [0.0, 0.01]]         # vols 0.2 and 0.1, zero correlation
    w = risk_parity_weights(cov)
    assert w == pytest.approx([1 / 3, 2 / 3], abs=1e-3)  # ERC == inverse-vol here


def test_risk_parity_equalises_risk_contribution_when_correlated():
    cov = [[0.04, 0.018], [0.018, 0.04]]     # equal vol, positive correlation
    w = risk_parity_weights(cov)
    assert w == pytest.approx([0.5, 0.5], abs=1e-3)  # symmetric → equal weights


def test_vol_target_only_derisks():
    cov = [[0.09, 0.0], [0.0, 0.09]]         # each name 30% vol
    w = [0.5, 0.5]
    scaled, gross = scale_gross_and_vol(w, cov, gross_cap=1.0, target_vol_pct=10.0)
    assert gross < 1.0 and sum(scaled) == pytest.approx(gross)
    # with no target, gross stays at the cap
    _, g2 = scale_gross_and_vol(w, cov, gross_cap=1.0, target_vol_pct=0.0)
    assert g2 == pytest.approx(1.0)


def test_target_weights_respects_cap_and_sums_within_gross():
    w, gross = target_weights(
        method="equal_weight", vols=[0.2, 0.2, 0.2], cov=[[0.04, 0, 0], [0, 0.04, 0], [0, 0, 0.04]],
        scores=[1, 1, 1], max_weight=0.5, gross_cap=1.0, target_vol_pct=0.0,
    )
    assert sum(w) == pytest.approx(1.0) and max(w) <= 0.5 + 1e-9


# --- portfolio backtest ------------------------------------------------------

def _axis(n: int, start: date = date(2021, 1, 1)) -> list[date]:
    return [start + timedelta(days=i) for i in range(n)]


def test_portfolio_backtest_basic_sanity():
    n = 300
    dates = _axis(n)
    # A rises ~0.1%/day, B flat
    a = [100.0 * (1.001 ** i) for i in range(n)]
    b = [50.0] * n
    curve, m, avg_w, long_now = run_portfolio_backtest(
        dates=dates,
        closes_by_name={"A": a, "B": b},
        in_market_by_name={"A": [True] * n, "B": [True] * n},
        score_by_name={"A": 1.0, "B": 0.5},
        spy_closes=None,
        method="equal_weight", max_weight=1.0, gross_cap=1.0, target_vol_pct=0.0,
        rebalance="monthly", vol_lookback_days=63, transaction_cost_bps=10.0,
    )
    assert len(curve) == n
    assert curve[0].strategy == pytest.approx(1.0)         # starts at 1.0 (cash during warm-up)
    assert curve[0].benchmark == pytest.approx(1.0)
    assert m.total_return_pct > 0                          # A's drift lifts the book
    assert m.n_rebalances >= 1
    assert avg_w["A"] > 0 and avg_w["B"] > 0
    assert long_now["A"] is True


def test_flat_when_nothing_long():
    n = 250
    dates = _axis(n)
    closes = {"A": [100.0] * n, "B": [50.0] * n}
    curve, m, _, _ = run_portfolio_backtest(
        dates=dates, closes_by_name=closes,
        in_market_by_name={"A": [False] * n, "B": [False] * n},
        score_by_name={"A": 0.5, "B": 0.5}, spy_closes=None,
        method="equal_weight", max_weight=1.0, gross_cap=1.0, target_vol_pct=0.0,
        rebalance="monthly", vol_lookback_days=63,
    )
    assert m.total_return_pct == pytest.approx(0.0, abs=1e-6)
    assert m.avg_gross_exposure_pct == pytest.approx(0.0)
