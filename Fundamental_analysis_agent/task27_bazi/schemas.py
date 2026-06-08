"""Task 27 — 八字（四柱）agent. ⚠️ CONTROL / PLACEBO ARM.

Casts a company's natal chart from its **listing/first-trade date**, reads the 日主
(Day Master) + 旺衰 + 喜用神, and holds the stock when the current 流年/流月 五行 is
favourable to the Day Master. No economic mechanism — a third control (with T25
astrology and T26 梅花易) to calibrate the suite's false-positive rate. The LLM writes
the 命書 narrative; the engine ignores it (selection ≠ execution).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["BaziEntrySignal", "BaziSpec", "Pillar", "BaziChart", "BaziResult", "Task27Job",
           "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

BaziEntrySignal = Literal[
    "buy_and_hold",
    "favorable_year",    # hold when the 流年 (annual) five-element is favourable to the Day Master
    "favorable_month",   # hold when the 流月 (monthly) five-element is favourable (more trades)
]


class BaziSpec(BaseModel):
    entry_signal: BaziEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class Pillar(BaseModel):
    role: str          # 年 / 月 / 日 / 時
    gz: str            # 干支, e.g. 庚申
    stem: str
    branch: str
    stem_elem: str
    branch_elem: str
    zodiac: str


class BaziChart(BaseModel):
    """The natal 命盤 — printed in the UI."""
    listing_date: date
    listing_date_is_data_limit: bool = False   # true when the firm pre-dates the price feed (e.g. KO 1962)
    pillars: list[Pillar] = Field(default_factory=list)
    day_master: str = ""        # 日主 stem
    dm_elem: str = ""           # 日主 五行
    strength_label: str = ""    # 身強 / 身弱
    favourable: list[str] = Field(default_factory=list)   # 喜用神 elements
    element_counts: dict[str, int] = Field(default_factory=dict)


class BaziResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True

    chart: BaziChart
    reasoning_chain: list[str] = Field(default_factory=list)

    prices: list[PricePoint]
    strategy: BaziSpec
    backtest: BacktestResult
    bazi_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task27Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: BaziResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
