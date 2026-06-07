"""Task 20 — VIX-regime risk gate (market-level overlay, prices only).

Uses CBOE VIX term structure (^VIX vs ^VIX3M via the price feed): when the curve
inverts (VIX > VIX3M, backwardation) the market is in a fear/stress regime;
otherwise it's calm (contango). The agent gates a ticker's long exposure by that
market regime — a risk-off overlay (also the natural exposure switch to feed Task
10 / Task 14). Lookahead-free (VIX realized at the close, acted on next open).
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

__all__ = ["VixEntrySignal", "Stance", "VixSpec", "VixResult", "Task20Job",
           "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult"]

VixEntrySignal = Literal[
    "buy_and_hold",
    "vix_term_gate",    # long while VIX < VIX3M * term_threshold (contango / calm)
    "vix_level_gate",   # long while VIX <= level_threshold
]


class VixSpec(BaseModel):
    entry_signal: VixEntrySignal
    term_threshold: float = 1.0      # VIX/VIX3M ceiling for "calm" (>=1 = inverted/fear)
    level_threshold: float = 25.0    # VIX level ceiling for "calm"
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class VixResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    prices: list[PricePoint]
    strategy: VixSpec
    backtest: BacktestResult
    vix_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task20Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: VixResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
