"""Task 24 — earnings-contagion agent.

When an industry bellwether reports, its read-across moves peers BEFORE the peers
report their own numbers. This agent takes a (bellwether, peer) pair, classifies the
bellwether's earnings 8-Ks (reusing Task 8's fetch + LLM classifier), and trades the
PEER in the window after each bellwether release — keyed to the bellwether's FILING
date, so it is lookahead-free. Reuses Task 17's generic factor backtest.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade
from task8_earnings.schemas import EarningsEvent

__all__ = ["ContagionEntrySignal", "ContagionSpec", "ContagionResult", "Task24Job",
           "EarningsEvent", "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

ContagionEntrySignal = Literal[
    "buy_and_hold",
    "follow_positive",        # long the peer for a window after a BULLISH bellwether report
    "avoid_after_negative",   # stand aside on the peer after a BEARISH bellwether report
]


class ContagionSpec(BaseModel):
    entry_signal: ContagionEntrySignal
    drift_days: int = 10               # read-across horizon after the bellwether files
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class ContagionResult(BaseModel):
    job_id: str
    bellwether: str
    peer: str                          # the traded name
    company_name: str | None = None
    as_of_date: date
    n_events: int = 0
    events: list[EarningsEvent] = Field(default_factory=list)
    prices: list[PricePoint]           # the PEER's prices
    strategy: ContagionSpec
    backtest: BacktestResult
    contagion_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task24Job(BaseModel):
    job_id: str
    tickers: list[str]                 # [bellwether, peer]
    status: JobStatus
    result: ContagionResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
