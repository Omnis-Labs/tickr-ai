"""Correctness tests for the ensemble combine engine. No LLM / network.

The properties that matter:
  * the in-market derivation matches a leg's trades (held [entry, exit)),
  * each combine_mode maps the two leg signals to the right target exposure,
  * the fractional backtest is lookahead-free and charges cost on turnover,
  * `defer_technical` reproduces the technical leg's own backtest (the ensemble
    of one agent IS that agent) — the key consistency check.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task4_technical.pipeline.backtest import run_backtest as run_tech_backtest
from task4_technical.schemas import PricePoint, TechnicalSpec, Trade
from task5_ensemble.pipeline.combine import (
    combined_exposure,
    inmarket_by_date,
    run_ensemble_backtest,
)


def _series(closes: list[float], start: date = date(2020, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(date=start + timedelta(days=i),
                              open=o, high=max(o, c), low=min(o, c), close=c, volume=1_000.0))
    return pts


def _dates(n: int, start: date = date(2020, 1, 1)) -> list[date]:
    return [start + timedelta(days=i) for i in range(n)]


# --- in-market derivation ----------------------------------------------------

def test_inmarket_held_from_entry_up_to_exit():
    ds = _dates(5)
    trades = [Trade(entry_date=ds[1], entry_price=1.0, exit_date=ds[3], exit_price=1.0)]
    flags = inmarket_by_date(trades, ds)
    assert [flags[d] for d in ds] == [False, True, True, False, False]


def test_inmarket_open_trade_held_to_end():
    ds = _dates(4)
    trades = [Trade(entry_date=ds[2], entry_price=1.0)]  # no exit
    flags = inmarket_by_date(trades, ds)
    assert [flags[d] for d in ds] == [False, False, True, True]


# --- combine modes -----------------------------------------------------------

def test_combine_modes_map_signals_to_exposure():
    ds = _dates(1)
    d = ds[0]
    def expo(mode, f, t, **kw):
        return combined_exposure(
            fund_in={d: f}, tech_in={d: t}, dates=ds, combine_mode=mode,
            fundamental_weight=kw.get("fw", 0.5), technical_weight=kw.get("tw", 0.5),
            fundamental_stance=kw.get("stance", "neutral"),
        )[d]

    assert expo("and", True, True) == 1.0
    assert expo("and", True, False) == 0.0
    assert expo("or", False, True) == 1.0
    assert expo("or", False, False) == 0.0
    assert expo("weighted", True, False, fw=0.3, tw=0.7) == pytest.approx(0.3)
    assert expo("weighted", True, True, fw=0.3, tw=0.7) == pytest.approx(1.0)  # clamped
    # gated: technical timing sized by fundamental conviction
    assert expo("fundamental_gated_technical", False, True, stance="bullish") == 1.0
    assert expo("fundamental_gated_technical", False, True, stance="neutral") == 0.5
    assert expo("fundamental_gated_technical", False, True, stance="cautious") == 0.0
    assert expo("defer_fundamental", True, False) == 1.0
    assert expo("defer_technical", True, False) == 0.0
    assert expo("unknown_mode", True, True) == 0.0  # fail-safe to flat


# --- consistency with the single-agent engine -------------------------------

def test_defer_technical_reproduces_technical_backtest():
    """An ensemble that defers to one agent must equal that agent's own backtest
    (to within the fractional engine's rebalancing of the same 0/1 series)."""
    closes = [100, 101, 102, 103, 102, 104, 106, 105, 107, 109, 110, 108]
    prices = _series(closes)
    spec = TechnicalSpec(entry_signal="buy_and_hold", exit_signal="hold")
    start = prices[0].date

    tech_bt = run_tech_backtest(prices, spec, start=start, transaction_cost_bps=10.0)
    dates = [p.date for p in prices]
    tech_in = inmarket_by_date(tech_bt.trades, dates)
    exposure = combined_exposure(
        fund_in={d: False for d in dates}, tech_in=tech_in, dates=dates,
        combine_mode="defer_technical", fundamental_weight=0.5, technical_weight=0.5,
        fundamental_stance="neutral",
    )
    ens_bt = run_ensemble_backtest(prices, exposure, start=start, transaction_cost_bps=10.0)

    # Same buy-and-hold exposure → same final equity within a few bps (both pay a
    # one-side entry cost; rounding/rebalance arithmetic differs marginally).
    assert ens_bt.metrics.total_return_pct == pytest.approx(tech_bt.metrics.total_return_pct, abs=0.2)
    assert ens_bt.metrics.benchmark_return_pct == pytest.approx(tech_bt.metrics.benchmark_return_pct, abs=0.01)


def test_flat_exposure_never_loses_money():
    prices = _series([100, 90, 80, 120, 70])
    dates = [p.date for p in prices]
    exposure = {d: 0.0 for d in dates}
    bt = run_ensemble_backtest(prices, exposure, start=prices[0].date, transaction_cost_bps=10.0)
    assert bt.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)
    assert bt.metrics.exposure_pct == pytest.approx(0.0)


def test_and_mode_only_invests_on_consensus():
    closes = [100, 102, 104, 106, 108, 110, 112, 114]
    prices = _series(closes)
    dates = [p.date for p in prices]
    fund_in = {d: True for d in dates}
    tech_in = {d: (i >= 4) for i, d in enumerate(dates)}  # technical only long late
    exposure = combined_exposure(
        fund_in=fund_in, tech_in=tech_in, dates=dates, combine_mode="and",
        fundamental_weight=0.5, technical_weight=0.5, fundamental_stance="bullish",
    )
    # invested only where BOTH are long
    assert all(exposure[d] == (1.0 if i >= 4 else 0.0) for i, d in enumerate(dates))
    bt = run_ensemble_backtest(prices, exposure, start=prices[0].date, transaction_cost_bps=10.0)
    assert 0.0 < bt.metrics.exposure_pct < 100.0
