"""Typed contracts for Task 11 — quantitative fundamentals-trend agent.

Where Task 3 reads the 10-K *text*, this agent reads the *structured numbers* from
SEC XBRL (`companyfacts` API): revenue, gross profit, net income per fiscal
quarter. It builds a lookahead-safe "fundamental momentum" signal — YoY revenue/
earnings growth and margin trend computed strictly as-of each filing's `filed`
date — and trades the well-documented tendency for improving fundamentals to be
rewarded (fundamental momentum / earnings-quality drift).

Free + EDGAR-native (reuses the Task 2/6 SEC client). Reuses Task 4's backtest
contracts (downstream consumer).
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
    "QuarterPoint",
    "FundEntrySignal",
    "FundExitSignal",
    "Stance",
    "FundTrendSpec",
    "FundTrendResult",
    "Task11Job",
    "PricePoint",
    "Trade",
    "EquityPoint",
    "BacktestMetrics",
    "BacktestResult",
]


class QuarterPoint(BaseModel):
    """One fiscal quarter's reported flow metrics, keyed by the filing date."""

    end: date                      # period end
    filed: date                    # filing date — the lookahead boundary
    fy: int
    fp: str                        # Q1 / Q2 / Q3 / Q4
    revenue: float | None = None
    gross_profit: float | None = None
    net_income: float | None = None


FundEntrySignal = Literal[
    "revenue_growth",      # long when YoY revenue growth >= threshold
    "earnings_growth",     # long when YoY net-income growth >= threshold
    "margin_expansion",    # long when gross margin expanded YoY
    "growth_and_margin",   # long when revenue growing AND margin expanding
    "any_improving",       # long when revenue OR earnings growing
]
FundExitSignal = Literal[
    "deteriorating",       # exit when the improvement condition fails on a new filing
    "time_exit",
    "hold",
]


class FundTrendSpec(BaseModel):
    """A fully-specified, executable fundamentals-trend strategy. Produced by the LLM."""

    entry_signal: FundEntrySignal
    exit_signal: FundExitSignal = "deteriorating"
    revenue_growth_threshold_pct: float = 0.0     # YoY revenue growth bar
    earnings_growth_threshold_pct: float = 0.0    # YoY net-income growth bar
    holding_days: int = 120

    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

    stance: Stance = "neutral"
    thesis: str = ""
    rationale_entry: str = ""
    rationale_exit: str = ""


class FundTrendResult(BaseModel):
    """Top-level Task 11 output."""

    job_id: str
    ticker: str
    company_name: str | None = None
    cik: int | None = None
    as_of_date: date

    n_quarters: int = 0
    quarters: list[QuarterPoint] = Field(default_factory=list)

    prices: list[PricePoint]
    strategy: FundTrendSpec
    backtest: BacktestResult
    fundamentals_readings: dict[str, float | str] = Field(default_factory=dict)

    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task11Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: FundTrendResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
