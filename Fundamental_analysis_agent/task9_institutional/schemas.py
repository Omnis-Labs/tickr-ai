"""Typed contracts for Task 9 — institutional / 13F superinvestor-tracking agent.

13F-HR filings are filed BY each institution (listing many securities by CUSIP),
not under the company's CIK — so there is no per-ticker index. The tractable,
free design is to track a curated set of well-known managers (Berkshire, Baupost,
Pershing Square, …), parse their 13F holdings, and follow whether they are
*accumulating* the target name. The signal is keyed off the 13F **filing date**
(~45 days after quarter end), so it is lookahead-safe — but that lag also means
this is a slow, context/confirmation signal, not a timing edge.

Honest limitations, surfaced in the UI: (1) only the curated funds are tracked,
not total institutional ownership; (2) holdings are matched to the company by
issuer NAME (13F has no ticker), which is fuzzy for similarly-named issuers.

Reuses Task 4's backtest contracts (downstream consumer, like Task 5/6/7/8/10).
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
    "FundHolding",
    "FundSummary",
    "InstitutionalEntrySignal",
    "InstitutionalExitSignal",
    "Stance",
    "InstitutionalSpec",
    "InstitutionalResult",
    "Task9Job",
    "PricePoint",
    "Trade",
    "EquityPoint",
    "BacktestMetrics",
    "BacktestResult",
]


class FundHolding(BaseModel):
    """One tracked fund's holding of the target as of one 13F filing."""

    filing_date: date              # 13F-HR filing date — the lookahead boundary
    fund_name: str
    shares: float
    value_usd: float = 0.0         # 13F reports value in $1000s; stored as raw $


class FundSummary(BaseModel):
    """Per-fund latest position, for the UI."""

    fund_name: str
    latest_shares: float
    latest_filing_date: date | None = None
    change: Literal["new", "added", "trimmed", "held", "exited", "absent"] = "absent"


InstitutionalEntrySignal = Literal[
    "any_holding",     # long while tracked funds collectively hold any shares
    "accumulating",    # long while aggregate tracked-fund shares are rising over the lookback
    "new_buying",      # long when aggregate shares rose over the most recent ~quarter
]
InstitutionalExitSignal = Literal[
    "hold",
    "distributing",    # exit when aggregate tracked-fund shares fall over the lookback
    "time_exit",
]


class InstitutionalSpec(BaseModel):
    """A fully-specified, executable 13F-following strategy. Produced by the LLM."""

    entry_signal: InstitutionalEntrySignal
    exit_signal: InstitutionalExitSignal = "distributing"
    accumulation_lookback_days: int = 180   # trailing window for the rising/falling test
    holding_days: int = 120

    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

    stance: Stance = "neutral"
    thesis: str = ""
    rationale_entry: str = ""
    rationale_exit: str = ""


class InstitutionalResult(BaseModel):
    """Top-level Task 9 output."""

    job_id: str
    ticker: str
    company_name: str | None = None
    cik: int | None = None
    as_of_date: date

    n_funds_tracked: int = 0
    n_funds_holding: int = 0
    funds: list[FundSummary] = Field(default_factory=list)

    prices: list[PricePoint]
    strategy: InstitutionalSpec
    backtest: BacktestResult
    institutional_readings: dict[str, float | str] = Field(default_factory=dict)

    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task9Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: InstitutionalResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
