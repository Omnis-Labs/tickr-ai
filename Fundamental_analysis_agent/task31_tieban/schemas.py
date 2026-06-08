"""Task 31 — 鐵板神數 (Iron-Plate Numerology) agent. ⚠️ CONTROL / PLACEBO."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["TiebanEntrySignal", "TiebanSpec", "TiebanPillar", "TiebanChart", "TiebanResult", "Task31Job",
           "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

TiebanEntrySignal = Literal["buy_and_hold", "verse_fortune", "avoid_inauspicious"]


class TiebanSpec(BaseModel):
    entry_signal: TiebanEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class TiebanPillar(BaseModel):
    role: str
    gz: str
    taixuan: int


class TiebanChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    pillars: list[TiebanPillar] = Field(default_factory=list)
    ming_number: int = 0
    liunian_verse_no: int = 0
    liunian_verdict: str = ""
    liunian_gua: str = ""


class TiebanResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True
    chart: TiebanChart
    reasoning_chain: list[str] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: TiebanSpec
    backtest: BacktestResult
    tieban_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task31Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: TiebanResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
