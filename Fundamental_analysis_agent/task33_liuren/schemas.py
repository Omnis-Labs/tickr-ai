"""Task 33 — 大六壬 (Da Liu Ren) agent. ⚠️ CONTROL / PLACEBO ARM."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["LiurenSpec", "LiurenChart", "LiurenResult", "Task33Job", "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

LiurenEntrySignal = Literal["buy_and_hold", "yong_supports", "avoid_ke"]


class LiurenSpec(BaseModel):
    entry_signal: LiurenEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class LiurenChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    day_master: str = ""
    yue_jiang: str = ""
    occupy_hour: str = ""
    yong_branch: str = ""
    relation: str = ""


class LiurenResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True
    chart: LiurenChart
    reasoning_chain: list[str] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: LiurenSpec
    backtest: BacktestResult
    liuren_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task33Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: LiurenResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
