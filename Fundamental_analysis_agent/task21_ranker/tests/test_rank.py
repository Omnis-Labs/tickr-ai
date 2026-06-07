"""Tests for the cross-sectional ranking factor math. No network."""

from __future__ import annotations

from datetime import date, timedelta

from task21_ranker.pipeline.rank import asof_factor_readings, build_membership, factor_value


def _ramp(start, step, n):
    """n closes starting at `start`, each +step (compounding-ish linear)."""
    out, c = [], float(start)
    for _ in range(n):
        out.append(c)
        c += step
    return out


def test_factor_value_insufficient_history_is_none():
    closes = [100.0, 101.0, 102.0]
    assert factor_value(closes, 3, "momentum_12_1", 252) is None       # < lookback
    assert factor_value(closes, 0, "near_52w_high", 252) is None       # end=0


def test_near_52w_high_at_new_high_is_one():
    closes = _ramp(100.0, 1.0, 300)                                    # strictly rising → last is the high
    v = factor_value(closes, 300, "near_52w_high", 252)
    assert v is not None and abs(v - 1.0) < 1e-9


def test_low_volatility_negates_vol():
    # a calm series should produce a HIGHER (less negative) low-vol factor than a wild one
    calm = _ramp(100.0, 0.1, 120)
    wild = [100.0 + (10.0 if i % 2 else -10.0) for i in range(120)]
    calm_v = factor_value(calm, 120, "low_volatility", 63)
    wild_v = factor_value(wild, 120, "low_volatility", 63)
    assert calm_v > wild_v


def test_short_term_reversal_loser_ranks_higher():
    riser = _ramp(100.0, 1.0, 40)
    faller = _ramp(140.0, -1.0, 40)
    # reversal negates the 1m return, so the faller (negative ret) gets a HIGHER factor
    assert factor_value(faller, 40, "short_term_reversal", 21) > factor_value(riser, 40, "short_term_reversal", 21)


def test_build_membership_selects_top_n():
    dates = [date(2023, 1, 1) + timedelta(days=i) for i in range(300)]
    closes = {
        "WIN": _ramp(100.0, 1.0, 300),       # strongest momentum
        "MID": _ramp(100.0, 0.3, 300),
        "LAG": _ramp(100.0, 0.05, 300),      # weakest
    }
    in_market, score, latest_val, latest_rank = build_membership(
        dates=dates, closes_by_name=closes, factor="momentum_12_1", top_n=1, lookback_days=252,
    )
    # only the strongest is held on the last bar
    assert in_market["WIN"][-1] and not in_market["LAG"][-1]
    assert latest_rank["WIN"] == 1
    assert score["WIN"] == 1.0


def test_asof_readings_have_dispersion_keys():
    closes = {"A": _ramp(100.0, 1.0, 300), "B": _ramp(100.0, 0.1, 300)}
    r = asof_factor_readings(closes)
    assert r["n_names"] == 2.0
    assert "momentum_dispersion_pct" in r and "momentum_12_1_pct_min_mean_max" in r
