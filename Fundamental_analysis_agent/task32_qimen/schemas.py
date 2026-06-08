"""Task 32 — 奇門遁甲 (Qimen Dunjia) agent. ⚠️ CONTROL / PLACEBO ARM."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["QimenSpec", "QimenChart", "QimenResult", "Task32Job", "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

QimenEntrySignal = Literal["buy_and_hold", "auspicious_gate", "avoid_ill_gate"]


class QimenSpec(BaseModel):
    entry_signal: QimenEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class GatePalace(BaseModel):
    palace: str
    gate: str
    cls: str


class QimenChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    dun: str = ""
    ju: str = ""
    active_gate: str = ""
    gate_class: str = ""
    layout: list[GatePalace] = Field(default_factory=list)


class QimenResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True
    chart: QimenChart
    reasoning_chain: list[str] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: QimenSpec
    backtest: BacktestResult
    qimen_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task32Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: QimenResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
