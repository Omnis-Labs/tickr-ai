"""Correctness tests for the overnight/gap agent. No network."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task13_overnight.pipeline.backtest import gap_readings, run_gap_backtest
from task13_overnight.schemas import GapSpec, PricePoint


def _series(specs: list[tuple[float, float]], start: date = date(2022, 1, 1)) -> list[PricePoint]:
    """specs = list of (open, close); high/low bracket them. Prev close → this open is the gap."""
    pts = []
    for i, (o, c) in enumerate(specs):
        pts.append(PricePoint(date=start + timedelta(days=i), open=o, high=max(o, c),
                              low=min(o, c), close=c, volume=1_000.0))
    return pts


def test_gap_readings_split():
    # every day gaps UP overnight (+1%) then flat intraday
    specs = [(100, 100)]
    px = 100.0
    for _ in range(60):
        op = px * 1.01      # overnight +1%
        cl = op             # intraday flat
        specs.append((op, cl)); px = cl
    r = gap_readings(_series(specs))
    assert r["overnight_ann_pct"] > 0 and r["overnight_share"] == "dominant"
    assert abs(r["intraday_ann_pct"]) < 1.0


def test_overnight_vs_intraday_decomposition_in_backtest():
    # overnight carries all the return; intraday flat → overnight strat (gross) >> intraday
    specs = [(100, 100)]
    px = 100.0
    for _ in range(120):
        op = px * 1.005
        specs.append((op, op)); px = op
    prices = _series(specs)
    on = run_gap_backtest(prices, GapSpec(entry_signal="overnight"), start=prices[0].date, transaction_cost_bps=0.0)
    intra = run_gap_backtest(prices, GapSpec(entry_signal="intraday"), start=prices[0].date, transaction_cost_bps=0.0)
    assert on.metrics.total_return_pct > intra.metrics.total_return_pct
    assert on.metrics.exposure_pct > 50  # participates most days


def test_costs_erase_overnight_edge():
    specs = [(100, 100)]
    px = 100.0
    for _ in range(120):
        op = px * 1.003
        specs.append((op, op)); px = op
    prices = _series(specs)
    free = run_gap_backtest(prices, GapSpec(entry_signal="overnight"), start=prices[0].date, transaction_cost_bps=0.0)
    costly = run_gap_backtest(prices, GapSpec(entry_signal="overnight"), start=prices[0].date, transaction_cost_bps=10.0)
    assert costly.metrics.total_return_pct < free.metrics.total_return_pct  # daily round-trip cost bites


def test_buy_and_hold_positive_on_uptrend():
    specs = [(100, 100)]
    px = 100.0
    for _ in range(120):
        op = px * 1.002
        specs.append((op, op * 1.001)); px = op * 1.001
    prices = _series(specs)
    r = run_gap_backtest(prices, GapSpec(entry_signal="buy_and_hold"), start=prices[0].date, transaction_cost_bps=10.0)
    assert r.metrics.total_return_pct > 0 and r.metrics.n_trades == 1
