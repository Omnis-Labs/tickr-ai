"""Tests for the pairs-trading math + backtest. No network."""

from __future__ import annotations

import math
from datetime import date, timedelta

from task23_pairs.pipeline.pairs import _half_life, _ols_beta, compute_z_series, run_pairs_backtest
from task23_pairs.schemas import PairSpec


def test_ols_beta_recovers_slope():
    xs = [float(i) for i in range(20)]
    ys = [3.0 + 2.0 * x for x in xs]          # y = 3 + 2x
    assert abs(_ols_beta(xs, ys) - 2.0) < 1e-6


def test_half_life_mean_reverting_is_positive_finite():
    # an AR(1) that mean-reverts: s_t = 0.5 s_{t-1} (+ tiny noise) → finite half-life
    s = [1.0]
    for _ in range(60):
        s.append(0.5 * s[-1] + 0.01)
    hl = _half_life(s)
    assert 0 < hl < 10


def test_z_series_lookahead_boundary():
    closes_a = [100 + math.sin(i / 5) for i in range(120)]
    closes_b = [100 + math.sin(i / 5) * 0.9 for i in range(120)]
    zs, betas = compute_z_series(closes_a, closes_b, 30)
    assert all(z is None for z in zs[:30])    # no signal before the formation window
    assert any(z is not None for z in zs[30:])


def _dates(n):
    return [date(2023, 1, 1) + timedelta(days=i) for i in range(n)]


def test_pairs_backtest_trades_on_divergence_and_reverts():
    # Build a spread that diverges then snaps back so a mean-reversion entry+exit fires.
    n = 160
    base = [100.0 + 0.05 * i for i in range(n)]      # common trend
    a = list(base)
    b = list(base)
    # inject a temporary divergence around bar 110: A jumps up, then reverts by ~125
    for i in range(110, 126):
        a[i] += 6.0 * (1 - (i - 110) / 16)
    spec = PairSpec(formation_window=40, z_entry=1.5, z_exit=0.5, stop_z=6.0, max_holding_days=60)
    r = run_pairs_backtest(_dates(n), a, b, spec, transaction_cost_bps=5.0)
    assert r.metrics.days > 0
    assert r.metrics.n_trades >= 1                    # at least one round-trip
    assert -100.0 < r.metrics.total_return_pct < 1000.0
    assert 0.0 <= r.metrics.exposure_pct <= 100.0
