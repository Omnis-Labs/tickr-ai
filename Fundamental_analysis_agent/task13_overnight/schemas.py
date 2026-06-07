"""Typed contracts for Task 13 — overnight vs intraday (gap) agent.

Prices only. Decomposes each day's return into the OVERNIGHT move (prior close →
open) and the INTRADAY move (open → close). The well-documented anomaly is that
US equity returns accrue disproportionately overnight while intraday is flat/
negative. This agent measures that split as-of and lets an LLM pick a
participation rule (overnight-only / intraday-only / buy-and-hold), then honestly
backtests it WITH realistic per-day round-trip costs — which is the catch, since
overnight-only trades every single day.

Reuses Task 4's backtest contracts.
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
    "GapEntrySignal", "Stance", "GapSpec", "GapResult", "Task13Job",
    "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult",
]

GapEntrySignal = Literal[
    "buy_and_hold",          # hold continuously (captures overnight + intraday)
    "overnight",             # hold prior-close → open every day
    "intraday",              # hold open → close every day
    "overnight_after_up",    # hold overnight only after an up day (lower turnover)
]


class GapSpec(BaseModel):
    entry_signal: GapEntrySignal
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class GapResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    prices: list[PricePoint]
    strategy: GapSpec
    backtest: BacktestResult
    gap_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task13Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: GapResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
