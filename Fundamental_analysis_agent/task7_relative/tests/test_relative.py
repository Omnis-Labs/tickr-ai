"""Correctness tests for the relative-strength agent. No network.

Properties that matter:
  * RS is ticker/benchmark, aligned to the ticker's dates (benchmark carried forward).
  * SMA / prior-high helpers are None-aware and lookahead-free (prior_high excludes today).
  * the backtest holds the TICKER, fires on RS, acts on the next open (no lookahead),
    and tracks the benchmark for buy_and_hold.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task7_relative.pipeline.backtest import run_relative_backtest
from task7_relative.pipeline.indicators import align_rs, prior_high, sma_none
from task7_relative.schemas import PricePoint, RelativeSpec


def _series(closes: list[float], start: date = date(2022, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o,
                              high=max(o, c), low=min(o, c), close=c, volume=1_000.0))
    return pts


# --- indicators --------------------------------------------------------------

def test_align_rs_is_ticker_over_benchmark():
    t = _series([100, 110, 120])
    b = _series([100, 100, 100])
    rs = align_rs(t, b)
    assert rs == pytest.approx([1.0, 1.1, 1.2])


def test_align_rs_carries_benchmark_forward_on_missing_date():
    t = _series([100, 110, 120])      # 3 bars
    b = _series([100])                # benchmark only has day-0 close = 100
    rs = align_rs(t, b)
    # benchmark carried forward → 100/100, 110/100, 120/100
    assert rs == pytest.approx([1.0, 1.1, 1.2])


def test_sma_none_requires_full_window():
    s = [1.0, 2.0, 3.0, 4.0]
    out = sma_none(s, 2)
    assert out[0] is None and out[1] == pytest.approx(1.5) and out[3] == pytest.approx(3.5)


def test_prior_high_excludes_current_bar():
    s = [1.0, 3.0, 2.0, 5.0]
    out = prior_high(s, 2)
    # at i=2, prior 2 bars = [1,3] → 3 (excludes the 2 at i=2)
    assert out[2] == pytest.approx(3.0)
    assert out[0] is None


# --- backtest ----------------------------------------------------------------

def test_buy_and_hold_tracks_benchmark_minus_costs():
    t = _series([100, 101, 102, 103, 104, 105])
    b = _series([100, 100, 100, 100, 100, 100])
    spec = RelativeSpec(entry_signal="buy_and_hold", exit_signal="hold")
    r = run_relative_backtest(t, b, spec, start=t[0].date, transaction_cost_bps=10.0)
    assert r.metrics.benchmark_return_pct == pytest.approx(5.0, abs=0.01)
    assert 0 < r.metrics.total_return_pct < r.metrics.benchmark_return_pct


def test_rs_uptrend_goes_long_when_outperforming():
    # ticker flat then accelerates; benchmark flat → RS rises through its SMA
    closes = [100] * 6 + [102, 104, 106, 108, 110, 112, 114, 116]
    t = _series(closes)
    b = _series([100] * len(closes))
    spec = RelativeSpec(entry_signal="rs_uptrend", exit_signal="rs_downtrend", rs_sma=3)
    r = run_relative_backtest(t, b, spec, start=t[0].date, transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1
    assert r.metrics.total_return_pct > 0


def test_no_relative_strength_means_flat():
    # ticker underperforms a rising benchmark → RS falls → rs_uptrend never fires
    closes = [100, 99, 98, 97, 96, 95, 94, 93]
    t = _series(closes)
    b = _series([100, 102, 104, 106, 108, 110, 112, 114])
    spec = RelativeSpec(entry_signal="rs_uptrend", exit_signal="rs_downtrend", rs_sma=3)
    r = run_relative_backtest(t, b, spec, start=t[0].date)
    assert r.metrics.n_trades == 0 and r.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)
