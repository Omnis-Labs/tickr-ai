"""Task 23 — pairs-trading (statistical-arbitrage) agent.

Two correlated tickers form a spread (logA − β·logB, β from a trailing OLS). When the
spread's rolling z-score stretches, we bet on mean-reversion: long the cheap leg /
short the rich leg, dollar-neutral; close when the spread normalises. This is the
suite's one genuinely LONG-SHORT, market-neutral strategy.

β and the z-score's mean/std are estimated from data STRICTLY BEFORE each bar; the
signal at close i executes at open i+1 — lookahead-free. Reuses Task 4's
BacktestMetrics/BacktestResult so the shared UI panel renders it unchanged.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestMetrics, BacktestResult, EquityPoint, Stance, Trade

__all__ = ["PairSpec", "PairResult", "Task23Job", "Stance", "BacktestMetrics", "BacktestResult",
           "EquityPoint", "Trade"]


class PairSpec(BaseModel):
    formation_window: int = 63         # trailing bars for β + spread mean/std
    z_entry: float = 2.0               # enter when |z| ≥ this
    z_exit: float = 0.5                # close when |z| ≤ this (reverted)
    stop_z: float = 4.0                # bail when |z| ≥ this (spread blew out — relationship broke)
    max_holding_days: int = 60
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class PairResult(BaseModel):
    job_id: str
    ticker_a: str
    ticker_b: str
    as_of_date: date
    common_window_start: date

    spec: PairSpec
    metrics: BacktestMetrics
    equity_curve: list[EquityPoint]     # strategy (neutral) vs 50/50 A+B basket vs SPY
    trades: list[Trade]
    pair_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task23Job(BaseModel):
    job_id: str
    tickers: list[str]
    status: JobStatus
    result: PairResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
