"""Task 19 — price-anomaly agent (prices only).

Bundles three classic price anomalies, lookahead-free, reusing the price feed +
Task 17's generic factor backtest. The LLM picks one:
  * **52-week-high momentum** (George & Hwang) — nearness to the trailing 52w high
    predicts continuation.
  * **MAX / lottery avoidance** — stocks with an extreme recent single-day spike
    tend to underperform; stand aside after one.
  * **Tax-loss reversal (January effect)** — year-to-date losers rebound in
    December–January.
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

__all__ = ["AnomalyEntrySignal", "Stance", "AnomalySpec", "AnomalyResult", "Task19Job",
           "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult"]

AnomalyEntrySignal = Literal[
    "buy_and_hold",
    "near_52w_high",       # long while close within high_threshold_pct of the trailing 52w high
    "avoid_max_lottery",   # long EXCEPT for max_window days after an extreme single-day spike
    "tax_loss_reversal",   # long in Dec–Jan when the trailing-11m return is negative (a YTD loser)
]


class AnomalySpec(BaseModel):
    entry_signal: AnomalyEntrySignal
    high_threshold_pct: float = 5.0       # "near" = within this % of the 52w high
    max_daily_threshold_pct: float = 10.0  # single-day move that flags a "lottery" spike
    max_window_days: int = 21              # how long to avoid after a lottery spike
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class AnomalyResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    prices: list[PricePoint]
    strategy: AnomalySpec
    backtest: BacktestResult
    anomaly_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task19Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: AnomalyResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
