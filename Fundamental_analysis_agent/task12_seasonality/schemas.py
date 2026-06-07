"""Typed contracts for Task 12 — seasonality / calendar-effects agent.

Prices only (no external data). Computes as-of calendar statistics (month-of-year
average returns, turn-of-month effect, sell-in-May) and lets an LLM pick a
calendar rule. Execution is purely calendar-driven, so it is lookahead-free by
construction (you always know the calendar ahead of time). The honest caveat: the
seasonal *pattern* is estimated in-sample, the weakest form of edge — surfaced in
the UI.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import (
    BacktestMetrics,
    BacktestResult,
    EquityPoint,
    PricePoint,
    Stance,
    Trade,
)

__all__ = [
    "SeasonalEntrySignal", "Stance", "SeasonalSpec", "SeasonalResult", "Task12Job",
    "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult",
]

SeasonalEntrySignal = Literal[
    "buy_and_hold",
    "best_months",     # long only during the chosen calendar months
    "sell_in_may",     # long Nov–Apr, flat May–Oct (the classic)
    "turn_of_month",   # long the last N + first M trading days of each month
]


class SeasonalSpec(BaseModel):
    entry_signal: SeasonalEntrySignal
    months: list[int] = Field(default_factory=list)  # 1–12, for best_months
    tom_before: int = 3      # trading days before month-end, for turn_of_month
    tom_after: int = 3       # trading days after month-start
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class SeasonalResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    prices: list[PricePoint]
    strategy: SeasonalSpec
    backtest: BacktestResult
    seasonality_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task12Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: SeasonalResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
