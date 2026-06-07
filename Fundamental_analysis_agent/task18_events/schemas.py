"""Task 18 — corporate-events / governance agent (SEC 8-K + Schedule 13D).

Reuses the Task 8 doc-fetch + filing-date discipline. Detects, from the company's
own EDGAR submissions: **Schedule 13D** (activist >5% stake — a positive drift
signal), and a basket of **red flags** — dilution (424B5 / S-3 shelf), late
filings (NT 10-K/Q), auditor changes (8-K 4.01), delisting notices (8-K 3.01), and
**adverse executive departures (8-K 5.02)**, where the LLM reads the 8-K text to
tell a forced/sudden CFO exit from a planned retirement (the LLM's edge over pure
quant). Everything is keyed off the filing date (lookahead-free); the strategy
rides activist drift and/or steps aside during red-flag windows. Long-only.
Reuses Task 4's backtest contracts + Task 17's generic factor backtest.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import (
    BacktestMetrics, BacktestResult, EquityPoint, PricePoint, Stance, Trade,
)

__all__ = ["EventRecord", "EventEntrySignal", "Stance", "EventSpec", "EventResult",
           "Task18Job", "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult"]


class EventRecord(BaseModel):
    date: date                 # filing date (lookahead boundary)
    kind: str                  # activist | dilution | late_filing | auditor_change | delisting | exec_departure
    polarity: Literal["positive", "negative", "neutral"]
    note: str = ""


EventEntrySignal = Literal[
    "buy_and_hold",
    "activist_drift",   # long for holding_days after each Schedule 13D filing
    "avoid_redflags",   # buy-and-hold, but flat for redflag_window_days after any red-flag event
]


class EventSpec(BaseModel):
    entry_signal: EventEntrySignal
    holding_days: int = 90              # post-13D drift horizon
    redflag_window_days: int = 90       # how long to stand aside after a red flag
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class EventResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    cik: int | None = None
    as_of_date: date
    n_events: int = 0
    events: list[EventRecord] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: EventSpec
    backtest: BacktestResult
    event_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task18Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: EventResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
