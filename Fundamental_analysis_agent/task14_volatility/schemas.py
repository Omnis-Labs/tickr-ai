"""Task 14 — volatility-regime / risk-management agent. Prices only.

Computes trailing realized volatility (and its percentile) as-of each bar and
trades a volatility-managed long/flat rule: participate when the regime is calm,
step aside when volatility spikes. Lookahead-free (vol uses only trailing
returns). Reuses Task 4's backtest contracts.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import (
    BacktestMetrics, BacktestResult, EquityPoint, PricePoint, Stance, Trade,
)

__all__ = ["VolEntrySignal", "Stance", "VolSpec", "VolResult", "Task14Job",
           "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult"]

VolEntrySignal = Literal[
    "buy_and_hold",
    "calm_regime",      # long while trailing annualised vol <= vol_threshold_pct
    "trend_and_calm",   # long while price > SMA(sma_window) AND vol is calm
]


class VolSpec(BaseModel):
    entry_signal: VolEntrySignal
    vol_window: int = 20            # trailing window for realized vol
    vol_threshold_pct: float = 30.0  # annualised-vol ceiling for "calm"
    sma_window: int = 100
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class VolResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    prices: list[PricePoint]
    strategy: VolSpec
    backtest: BacktestResult
    volatility_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task14Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: VolResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
