"""Typed contracts for Task 21 — cross-sectional ranking agent.

Where Task 10 *sizes* a basket whose membership comes from each name's own
long/flat signal, Task 21 *selects* the basket: at every rebalance it ranks the
whole watchlist by ONE cross-sectional factor (computed from trailing data only)
and holds the top slice, equal- or inverse-vol weighted. This is the classic
long-only factor-portfolio construction — momentum, low-vol, 52-week-high, or
short-term reversal — tested against the always-invested equal-weight basket and
the S&P 500.

The portfolio-level contracts (PortfolioPoint / PortfolioMetrics) are reused
verbatim from Task 10; only the *selection* differs, so this module declares just
the spec, the per-name summary, and the job envelope.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task10_portfolio.schemas import PortfolioMetrics, PortfolioPoint

Stance = Literal["bullish", "neutral", "cautious"]
# The cross-sectional factor used to rank the universe each rebalance.
RankFactor = Literal["momentum_12_1", "low_volatility", "near_52w_high", "short_term_reversal"]
# How to weight the selected top slice (subset of Task 10's sizing menu).
WeightMethod = Literal["equal_weight", "inverse_vol"]
Rebalance = Literal["weekly", "monthly", "quarterly"]


class RankSpec(BaseModel):
    """The LLM-chosen selection policy. Consumed by the cross-sectional backtest verbatim."""

    factor: RankFactor = "momentum_12_1"
    top_n: int = 5                      # how many names to hold (clamped to < universe size)
    weight_method: WeightMethod = "equal_weight"
    rebalance: Rebalance = "monthly"
    lookback_days: int = 252            # trailing window the factor is measured over
    max_weight: float = 0.40            # single-name cap

    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class RankHolding(BaseModel):
    """Per-name summary for the UI: its current factor rank + portfolio role."""

    ticker: str
    available: bool = True
    factor_value: float | None = None       # the latest trailing factor reading
    rank: int | None = None                  # 1 = best on the most recent bar
    selected_now: bool = False               # in the top-N as of the last bar?
    avg_weight_pct: float = 0.0
    standalone_return_pct: float | None = None
    note: str = ""


class RankResult(BaseModel):
    """Top-level Task 21 output."""

    job_id: str
    tickers: list[str]
    as_of_date: date
    common_window_start: date

    spec: RankSpec
    holdings: list[RankHolding]
    metrics: PortfolioMetrics
    equity_curve: list[PortfolioPoint]
    universe_readings: dict[str, float | str] = Field(default_factory=dict)

    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task21Job(BaseModel):
    job_id: str
    tickers: list[str]
    status: JobStatus
    result: RankResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
