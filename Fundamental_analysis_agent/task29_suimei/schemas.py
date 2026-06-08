"""Task 29 — 四柱推命 (Japanese Shichū-Suimei, 京都泰山流) agent. ⚠️ CONTROL / PLACEBO.

The Japanese reading of the four 干支 pillars: 十二運星 (life-stage cycle of the 日主)
and 空亡/天中殺 (the void pair) are the spine, not footnotes. Signal holds in thriving
fortune stages / steps aside during 天中殺 years. A 5th control (with T25 占星, T26 梅花易,
T27 八字, T28 紫微) to calibrate the suite's false-positive rate. Reuses T27's 干支 calendar.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["SuimeiEntrySignal", "SuimeiSpec", "Pillar", "SuimeiChart", "SuimeiResult", "Task29Job",
           "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

SuimeiEntrySignal = Literal[
    "buy_and_hold",
    "twelve_fortune",      # hold in 旺 stages (長生/冠帶/臨官/帝旺) of the 流年, flat in 衰絕
    "avoid_tenchusatsu",   # stand aside when the 流年 branch falls in the natal 天中殺 pair
]


class SuimeiSpec(BaseModel):
    entry_signal: SuimeiEntrySignal
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class Pillar(BaseModel):
    role: str          # 年 / 月 / 日 / 時
    gz: str
    stem: str
    branch: str
    twelve_fortune: str   # 十二運星 of the day master at this pillar's branch
    hidden: list[str] = Field(default_factory=list)   # 藏干 (本氣→餘氣)


class SuimeiChart(BaseModel):
    listing_date: date
    listing_date_is_data_limit: bool = False
    day_master: str = ""
    day_master_elem: str = ""
    tenchusatsu: str = ""          # 天中殺 pair, e.g. 申酉
    pillars: list[Pillar] = Field(default_factory=list)
    liunian_branch: str = ""
    liunian_fortune: str = ""      # 十二運星 of the day master at the current 流年 branch
    liunian_in_tenchusatsu: bool = False


class SuimeiResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True

    chart: SuimeiChart
    reasoning_chain: list[str] = Field(default_factory=list)

    prices: list[PricePoint]
    strategy: SuimeiSpec
    backtest: BacktestResult
    suimei_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task29Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: SuimeiResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
