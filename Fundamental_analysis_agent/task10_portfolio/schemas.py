"""Typed contracts for Task 10 — portfolio / risk & position-sizing agent.

This is the capstone: it consumes the per-name long/flat signals of an existing
single-ticker agent (Task 4 technical by default) across a watchlist, an LLM picks
one *sizing policy* from a fixed DSL, and a deterministic, lookahead-free
*portfolio* backtest allocates across names with risk controls (single-name cap,
gross cap, vol targeting) and periodic rebalancing.

Unlike Tasks 3–7 (single-name long/flat), the unit here is a multi-name book, so
this module declares its own portfolio-level contracts (PortfolioPoint /
PortfolioMetrics) rather than reusing the single-ticker BacktestMetrics — the
fields differ (n_holdings, gross exposure, turnover, realized vs target vol).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus

Stance = Literal["bullish", "neutral", "cautious"]
SizingMethod = Literal["equal_weight", "inverse_vol", "risk_parity", "signal_proportional"]
Rebalance = Literal["weekly", "monthly", "quarterly"]


class PortfolioSpec(BaseModel):
    """The LLM-chosen sizing policy. Consumed by the portfolio backtest verbatim."""

    method: SizingMethod = "inverse_vol"
    max_weight: float = 0.30            # single-name cap (after which weight is clipped + redistributed)
    gross_cap: float = 1.0              # max invested fraction of the book (rest = cash)
    target_vol_pct: float = 0.0         # annualised portfolio-vol target; 0 = disabled. De-risk only (long-only).
    rebalance: Rebalance = "monthly"
    vol_lookback_days: int = 63         # trailing window for vol / covariance estimates

    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class Holding(BaseModel):
    """Per-name summary for the UI (the leg's standalone read + its portfolio role)."""

    ticker: str
    available: bool = True
    stance: Stance | None = None
    entry_signal: str | None = None
    long_as_of: bool = False            # is the name long on the most recent bar?
    ann_vol_pct: float | None = None    # trailing annualised vol
    standalone_return_pct: float | None = None  # the T4 leg's own return over the common window
    avg_weight_pct: float = 0.0         # average portfolio weight across the backtest
    note: str = ""


class PortfolioPoint(BaseModel):
    date: date
    strategy: float                     # sized/gated/risk-controlled book, starts at 1.0
    benchmark: float                    # equal-weight, always-invested buy-and-hold of the SAME names
    market: float | None = None         # S&P 500 (SPY) over the same window


class PortfolioMetrics(BaseModel):
    total_return_pct: float
    benchmark_return_pct: float         # equal-weight basket (always invested)
    excess_return_pct: float            # strategy − equal-weight basket
    market_return_pct: float | None = None       # SPY
    excess_vs_market_pct: float | None = None     # strategy − market = alpha vs market
    cagr_pct: float
    sharpe: float
    max_drawdown_pct: float
    ann_vol_pct: float                  # realised annualised vol of the strategy
    target_vol_pct: float = 0.0         # the target, if vol-targeting was on (else 0)
    avg_n_holdings: float               # mean number of names held
    avg_gross_exposure_pct: float       # mean invested fraction
    n_rebalances: int
    turnover_annual_pct: float          # annualised one-way turnover
    days: int
    transaction_cost_bps: float


class PortfolioResult(BaseModel):
    """Top-level Task 10 output."""

    job_id: str
    tickers: list[str]
    signal_source: str = "task4_technical"
    as_of_date: date
    common_window_start: date

    spec: PortfolioSpec
    holdings: list[Holding]
    metrics: PortfolioMetrics
    equity_curve: list[PortfolioPoint]
    # The as-of universe stats the LLM saw (breadth, mean vol, mean correlation…).
    universe_readings: dict[str, float | str] = Field(default_factory=dict)

    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task10Job(BaseModel):
    job_id: str
    tickers: list[str]
    status: JobStatus
    result: PortfolioResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
