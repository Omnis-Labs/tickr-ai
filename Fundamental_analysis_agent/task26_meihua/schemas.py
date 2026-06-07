"""Task 26 — 梅花易數 (Plum-Blossom I Ching) agent. ⚠️ CONTROL / PLACEBO ARM.

Like Task 25, this has NO economic mechanism — it is a control to calibrate the
suite's false-positive rate, and the engine behind the suite's null-distribution /
White's-Reality-Check-lite (run N seeds → a null Sharpe distribution the real
agents are measured against). Casting is a deterministic function of the date(+seed):
one date → one hexagram, reproducible and zero-lookahead. The LLM writes the 卦辭
narrative; the backtest executes a fixed 體用生剋 rule (selection ≠ execution).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["MeihuaEntrySignal", "MeihuaSpec", "HexagramChart", "MeihuaResult", "Task26Job",
           "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

MeihuaEntrySignal = Literal[
    "buy_and_hold",
    "ti_yong_auspicious",   # long when the 體用五行 verdict is auspicious (用生體 / 比和 / 體剋用)
    "yang_ti",              # long when the 體卦 is a yang trigram (乾震坎艮)
]


class MeihuaSpec(BaseModel):
    entry_signal: MeihuaEntrySignal
    seed: int = 0                      # deterministic casting shift — used by the null-distribution harness
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class HexagramChart(BaseModel):
    """The as-of 命盤 — printed in the UI."""
    upper: str
    lower: str
    moving_line: int
    line_diagram: list[str] = Field(default_factory=list)
    ben_gua: str = ""        # 本卦 (original)
    hu_gua: str = ""         # 互卦 (nuclear)
    bian_gua: str = ""       # 變卦 (changed)
    ti: str = ""             # 體卦 (body / self)
    yong: str = ""           # 用卦 (use / other)
    ti_wuxing: str = ""
    yong_wuxing: str = ""
    relation: str = ""       # the 生剋 relation label
    verdict: str = ""        # 吉 / 凶 / 平
    auspicious: bool = False


class MeihuaResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True

    hexagram: HexagramChart
    reasoning_chain: list[str] = Field(default_factory=list)   # the 起卦→體用→生剋→變卦 chain

    prices: list[PricePoint]
    strategy: MeihuaSpec
    backtest: BacktestResult
    meihua_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task26Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: MeihuaResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
