"""Tests for the short-pressure agent. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task16_short.pipeline.backtest import run_short_backtest, short_readings, svr_asof
from task16_short.pipeline.finra import _parse
from task16_short.schemas import PricePoint, ShortSpec


def test_parse_finra_line():
    txt = "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20260603|AAPL|600|0|1500|B,Q,N\n"
    assert _parse(txt, "AAPL") == pytest.approx(40.0)   # 600/1500
    assert _parse(txt, "MSFT") is None


def test_svr_asof_uses_strictly_prior_sample():
    series = [(date(2024, 1, 1), 30.0), (date(2024, 2, 1), 60.0)]
    assert svr_asof(series, date(2024, 1, 15)) == 30.0     # only Jan known
    assert svr_asof(series, date(2024, 2, 1)) == 30.0      # strictly-before → still Jan (lag)
    assert svr_asof(series, date(2024, 2, 2)) == 60.0


def test_short_readings_regime():
    series = [(date(2024, 1, 1) + timedelta(days=7 * i), 20.0 + i) for i in range(20)]
    r = short_readings(series)
    assert "short_regime" in r and "current_short_vol_ratio_pct" in r and r["n_samples"] == 20.0


def _series(closes, start=date(2024, 1, 1)):
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i), open=o, high=max(o, c), low=min(o, c), close=c, volume=1e6))
    return pts


def test_low_short_enters_only_when_ratio_below_threshold():
    prices = _series([100 + i for i in range(60)])
    # short volume high early, low later
    svr = [(prices[5].date, 70.0), (prices[30].date, 20.0)]
    spec = ShortSpec(entry_signal="low_short", exit_signal="hold", svr_threshold_pct=40.0, holding_days=999)
    r = run_short_backtest(prices, svr, spec, start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.n_trades >= 1
    assert all(t.entry_date > prices[30].date for t in r.trades)  # only after the low-short sample


def test_no_short_data_buy_and_hold_still_works():
    prices = _series([100 + i for i in range(60)])
    r = run_short_backtest(prices, [], ShortSpec(entry_signal="buy_and_hold"), start=prices[0].date)
    assert r.metrics.total_return_pct > 0
