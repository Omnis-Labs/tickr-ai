"""Task 25 — financial-astrology agent. ⚠️ CONTROL / PLACEBO ARM.

This agent has NO known economic mechanism. It exists to calibrate the suite's
false-positive rate: it runs the *same* lookahead-free backtest as every real
agent, on a signal source known to be predictively worthless (planetary
positions). If a placebo like this prints a high Sharpe, the framework is leaking
— not the planets working. Astronomical positions are a pure deterministic
function of the date (more lookahead-free than any SEC filing), computed offline
via `ephem`.

The LLM writes a florid astrological *thesis*; the backtest ignores it and
executes a fixed deterministic rule — the ultimate test of selection ≠ execution.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["AstroEntrySignal", "AstroSpec", "PlanetPosition", "AstroResult", "Task25Job",
           "Stance", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]

AstroEntrySignal = Literal[
    "buy_and_hold",
    "avoid_mercury_retrograde",   # flat while Mercury is retrograde (folk-finance staple)
    "moon_phase_long",            # long waxing (new→full), flat waning — the lunar-cycle anomaly
    "benefic_aspect",             # long when Jupiter/Venus make a benefic aspect to the Sun
]


class AstroSpec(BaseModel):
    entry_signal: AstroEntrySignal
    aspect_orb_deg: float = 6.0       # how tight an aspect must be to count
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class PlanetPosition(BaseModel):
    body: str
    ecliptic_lon: float
    sign: str
    retrograde: bool = False


class AstroResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    is_control: bool = True            # flagged everywhere so it's never mistaken for a real signal

    chart: list[PlanetPosition] = Field(default_factory=list)   # the 星盤 as-of
    aspects: list[str] = Field(default_factory=list)            # current notable aspects
    reasoning_chain: list[str] = Field(default_factory=list)    # the deterministic read, step by step

    prices: list[PricePoint]
    strategy: AstroSpec
    backtest: BacktestResult
    astro_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task25Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: AstroResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
