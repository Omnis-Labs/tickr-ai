"""Task 35 — Jyotiṣa (Vedic astrology) agent. ⚠️ CONTROL / PLACEBO ARM."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["JyotishSpec", "JyotishChart", "JyotishResult", "Task35Job", "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

JyotishEntrySignal = Literal["buy_and_hold", "benefic_dasha", "avoid_malefic_dasha"]


class JyotishSpec(BaseModel):
    entry_signal: JyotishEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class Graha(BaseModel):
    name: str
    sidereal_lon: float
    rashi: str


class JyotishChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    grahas: list[Graha] = Field(default_factory=list)
    moon_nakshatra: str = ""
    moon_rashi: str = ""
    mahadasha_lord: str = ""
    dasha_nature: str = ""
    ayanamsa_deg: float = 0.0


class JyotishResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True
    chart: JyotishChart
    reasoning_chain: list[str] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: JyotishSpec
    backtest: BacktestResult
    jyotish_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task35Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: JyotishResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
