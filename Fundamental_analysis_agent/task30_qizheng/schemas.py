"""Task 30 — 七政四餘 (Chinese horoscopic astrology) agent. ⚠️ CONTROL / PLACEBO."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["QizhengEntrySignal", "QizhengSpec", "Star", "QizhengChart", "QizhengResult", "Task30Job",
           "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

QizhengEntrySignal = Literal["buy_and_hold", "benefic_transit", "avoid_malefic"]


class QizhengSpec(BaseModel):
    entry_signal: QizhengEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class Star(BaseModel):
    name: str
    ecliptic_lon: float
    sign: str


class QizhengChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    ming_zhu_sign: str = ""          # 命主 (natal Sun) sign
    seven: list[Star] = Field(default_factory=list)   # 七政
    siyu: list[Star] = Field(default_factory=list)     # 四餘
    jupiter_sign: str = ""
    mars_sign: str = ""
    rahu_sign: str = ""


class QizhengResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True
    chart: QizhengChart
    reasoning_chain: list[str] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: QizhengSpec
    backtest: BacktestResult
    qizheng_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task30Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: QizhengResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
