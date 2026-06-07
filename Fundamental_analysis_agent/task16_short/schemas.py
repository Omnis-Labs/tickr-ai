"""Task 16 — short-pressure / squeeze agent.

Two complementary free data sources, both lagged to their publish date so the
signal is lookahead-safe:
  • FINRA daily **short-VOLUME** (CNMS regsho): the fraction of a day's volume that
    was short-sale executions — a high-frequency *pressure gauge* (weekly-sampled).
  • NASDAQ bi-monthly settlement **short-INTEREST** (outstanding shorts +
    days-to-cover): the real exchange-reported overhang, ~12 months of history.
Honest distinctions surfaced in the UI: (1) short VOLUME ≠ short INTEREST; (2)
FINRA short volume includes market-maker hedging, so a high ratio is not purely
bearish; (3) short interest is bi-monthly and published ~8 business days late, so
it is keyed to its publish date.

Reuses Task 4's backtest contracts.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import (
    BacktestMetrics, BacktestResult, EquityPoint, PricePoint, Stance, Trade,
)

__all__ = ["ShortEntrySignal", "ShortExitSignal", "Stance", "ShortSpec", "ShortResult",
           "Task16Job", "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult"]

ShortEntrySignal = Literal[
    "buy_and_hold",
    "squeeze",        # long when short-VOLUME ratio is elevated AND price > SMA (ride the squeeze)
    "low_short",      # long when short-VOLUME ratio is low (little overhang)
    "si_squeeze",     # long when days-to-cover (short INTEREST) is elevated AND price > SMA
    "low_si",         # long when days-to-cover is low (little outstanding short overhang)
]
ShortExitSignal = Literal["short_normalizes", "time_exit", "hold"]


class ShortSpec(BaseModel):
    entry_signal: ShortEntrySignal
    exit_signal: ShortExitSignal = "time_exit"
    svr_threshold_pct: float = 50.0   # short-volume-ratio threshold (percent of volume)
    dtc_threshold: float = 3.0        # days-to-cover threshold for the short-INTEREST signals
    sma_window: int = 50
    holding_days: int = 40
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class ShortResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    n_samples: int = 0
    prices: list[PricePoint]
    strategy: ShortSpec
    backtest: BacktestResult
    short_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task16Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: ShortResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
