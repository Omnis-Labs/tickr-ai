"""Task 15 — share-buyback agent.

Reuses the SEC XBRL companyfacts feed (Task 11): a falling diluted share count is
direct evidence of net buybacks. Builds a lookahead-safe signal — YoY change in
weighted-average diluted shares, keyed off the filing date — and trades the
tendency for sustained buybacks (shareholder-yield / shrinking float) to support
returns. Reuses Task 4's backtest contracts.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import (
    BacktestMetrics, BacktestResult, EquityPoint, PricePoint, Stance, Trade,
)

__all__ = ["SharePoint", "BuybackEntrySignal", "BuybackExitSignal", "Stance",
           "BuybackSpec", "BuybackResult", "Task15Job",
           "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult"]


class SharePoint(BaseModel):
    end: date
    filed: date
    fy: int
    fp: str
    diluted_shares: float


BuybackEntrySignal = Literal[
    "buy_and_hold",
    "buyback",             # long when YoY diluted shares fell by >= reduction_threshold_pct
    "aggressive_buyback",  # long when the reduction is large (>= 2x the threshold)
]
BuybackExitSignal = Literal["stops_buyback", "time_exit", "hold"]


class BuybackSpec(BaseModel):
    entry_signal: BuybackEntrySignal
    exit_signal: BuybackExitSignal = "stops_buyback"
    reduction_threshold_pct: float = 1.0    # YoY % share-count reduction to qualify
    holding_days: int = 120
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class BuybackResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    cik: int | None = None
    as_of_date: date
    n_quarters: int = 0
    shares: list[SharePoint] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: BuybackSpec
    backtest: BacktestResult
    buyback_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task15Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: BuybackResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
