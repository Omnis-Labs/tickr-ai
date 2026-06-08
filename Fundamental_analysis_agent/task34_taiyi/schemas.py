"""Task 34 — 太乙神數 (Taiyi Shenshu) agent. ⚠️ CONTROL / PLACEBO ARM."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["TaiyiSpec", "TaiyiChart", "TaiyiResult", "Task34Job", "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

TaiyiEntrySignal = Literal["buy_and_hold", "host_prevails", "avoid_guest_win"]


class TaiyiSpec(BaseModel):
    entry_signal: TaiyiEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class TaiyiChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    accumulated_years: int = 0
    taiyi_palace: str = ""
    host_count: int = 0
    guest_count: int = 0
    verdict: str = ""


class TaiyiResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True
    chart: TaiyiChart
    reasoning_chain: list[str] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: TaiyiSpec
    backtest: BacktestResult
    taiyi_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task34Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: TaiyiResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
