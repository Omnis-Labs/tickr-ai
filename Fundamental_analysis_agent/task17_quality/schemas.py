"""Task 17 — fundamental-quality factor agent (XBRL).

Bundles three classic, free, point-in-time quality factors computed from SEC XBRL
`companyfacts` (reusing Task 11's pipeline): the **Piotroski F-Score** (9 binary
fundamental-health checks), **Sloan accruals** (earnings quality: net income vs
operating cash flow), and the **asset-growth anomaly** (aggressive expanders
underperform). The LLM picks which factor (or a composite) to gate on — exactly
how Task 4 bundles many technical signals. Everything is keyed off the annual
filing date and uses as-originally-filed values (lookahead-free). Reuses Task 4's
backtest contracts.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import (
    BacktestMetrics, BacktestResult, EquityPoint, PricePoint, Stance, Trade,
)

__all__ = ["QualityEntrySignal", "QualityExitSignal", "Stance", "QualitySpec",
           "QualityResult", "Task17Job",
           "PricePoint", "Trade", "EquityPoint", "BacktestMetrics", "BacktestResult"]

QualityEntrySignal = Literal[
    "buy_and_hold",
    "f_score",            # long when Piotroski F-Score >= f_threshold
    "low_accruals",       # long when accruals/assets <= max_accruals_pct (earnings quality)
    "low_asset_growth",   # long when YoY asset growth <= max_asset_growth_pct
    "composite_quality",  # long when high F-Score AND low accruals AND low asset growth
]
QualityExitSignal = Literal["deteriorating", "time_exit", "hold"]


class QualitySpec(BaseModel):
    entry_signal: QualityEntrySignal
    exit_signal: QualityExitSignal = "deteriorating"
    f_threshold: int = 7                 # F-Score bar (0–9)
    max_accruals_pct: float = 10.0       # |accruals|/assets ceiling (%)
    max_asset_growth_pct: float = 25.0   # YoY asset-growth ceiling (%)
    holding_days: int = 250
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class QualityResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    cik: int | None = None
    as_of_date: date
    prices: list[PricePoint]
    strategy: QualitySpec
    backtest: BacktestResult
    quality_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task17Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: QualityResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
