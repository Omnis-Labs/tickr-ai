"""Provider-dispatch + fallback tests for fetch_prices. No network.

The price data itself comes from yfinance/Tiingo (exercised live), so here we pin
only the pluggable-source logic: the configured provider is used, a failing paid
provider falls back to yfinance, and a yfinance failure still propagates.
"""

from __future__ import annotations

from datetime import date

import pytest

from task3_strategy.pipeline import prices as P
from task3_strategy.schemas import PricePoint


def _pp(d: int) -> PricePoint:
    return PricePoint(date=date(2024, 1, d), open=1.0, high=1.0, low=1.0, close=1.0, volume=1.0)


@pytest.fixture(autouse=True)
def _no_cache(monkeypatch):
    # bypass disk cache so we test the live dispatch path deterministically
    monkeypatch.setattr(P, "_load_cache", lambda t, prov: None)
    monkeypatch.setattr(P, "_save_cache", lambda t, prov, out: None)


class _S:
    def __init__(self, provider):
        self.price_provider = provider
        self.tiingo_api_key = "x"
        self.artifact_dir = "/tmp"


def test_uses_configured_provider(monkeypatch):
    calls = []
    monkeypatch.setattr(P, "get_settings", lambda: _S("tiingo"))
    monkeypatch.setattr(P, "_PROVIDERS", {
        "yfinance": lambda t: [_pp(9)],
        "tiingo": lambda t: (calls.append("tiingo"), [_pp(1), _pp(2)])[1],
    })
    out = P.fetch_prices("AAPL")
    assert calls == ["tiingo"] and len(out) == 2


def test_falls_back_to_yfinance_when_provider_errors(monkeypatch):
    monkeypatch.setattr(P, "get_settings", lambda: _S("tiingo"))

    def _boom(t):
        raise RuntimeError("tiingo down")

    monkeypatch.setattr(P, "_PROVIDERS", {"yfinance": lambda t: [_pp(3)], "tiingo": _boom})
    monkeypatch.setattr(P, "_fetch_yfinance", lambda t: [_pp(3), _pp(4)])  # the fallback path
    out = P.fetch_prices("AAPL")
    assert len(out) == 2  # served by the yfinance fallback, not a crash


def test_yfinance_failure_propagates(monkeypatch):
    monkeypatch.setattr(P, "get_settings", lambda: _S("yfinance"))

    def _boom(t):
        raise RuntimeError("no price data")

    monkeypatch.setattr(P, "_PROVIDERS", {"yfinance": _boom})
    with pytest.raises(RuntimeError):
        P.fetch_prices("ZZZZ")


def test_start_end_filter(monkeypatch):
    monkeypatch.setattr(P, "get_settings", lambda: _S("yfinance"))
    monkeypatch.setattr(P, "_PROVIDERS", {"yfinance": lambda t: [_pp(1), _pp(2), _pp(3), _pp(4)]})
    out = P.fetch_prices("AAPL", start=date(2024, 1, 2), end=date(2024, 1, 3))
    assert [p.date.day for p in out] == [2, 3]
