"""Task 28 — 紫微斗數（四化飛星）agent. ⚠️ CONTROL / PLACEBO ARM.

Casts a company's 紫微 命盤 from its listing date (via py_iztro), then trades on the
四化飛星: holds when the year's 化祿/化權 fly into the natal 命宮/財帛/官祿, stands aside
when 化忌 does. A fourth control (with T25 占星, T26 梅花易, T27 八字) to calibrate the
suite's false-positive rate. The LLM writes the 命書; the engine ignores it.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["ZiweiEntrySignal", "ZiweiSpec", "Palace", "ZiweiChart", "ZiweiResult", "Task28Job",
           "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

ZiweiEntrySignal = Literal[
    "buy_and_hold",
    "sihua_year",     # hold when the 流年 四化 fly favourably into 命宮/財帛/官祿
    "sihua_month",    # same on the 流月 四化 (more trades)
]


class ZiweiSpec(BaseModel):
    entry_signal: ZiweiEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class Palace(BaseModel):
    name: str           # 宮名 e.g. 命宮 / 財帛 / 官祿
    branch: str         # 地支
    is_body: bool = False
    stars: list[str] = Field(default_factory=list)   # 主星（含四化標記）+ 輔星


class ZiweiChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    soul_star: str = ""          # 命宮主星
    body_star: str = ""          # 身宮主星
    five_elements_class: str = ""  # 五行局
    palaces: list[Palace] = Field(default_factory=list)
    liunian_stem: str = ""
    liunian_sihua: str = ""      # e.g. 廉貞化祿、破軍化權、武曲化科、太陽化忌
    sihua_landing: dict[str, str] = Field(default_factory=dict)   # 化X → star→palace
    target_palaces: list[str] = Field(default_factory=lambda: ["命宮", "財帛", "官祿"])


class ZiweiResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True

    chart: ZiweiChart
    reasoning_chain: list[str] = Field(default_factory=list)

    prices: list[PricePoint]
    strategy: ZiweiSpec
    backtest: BacktestResult
    ziwei_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task28Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: ZiweiResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
