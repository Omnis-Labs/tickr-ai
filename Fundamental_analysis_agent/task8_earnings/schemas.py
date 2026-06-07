"""Typed contracts for Task 8 — earnings-release (SEC 8-K) agent.

SEC does not host earnings-call transcripts, but companies furnish their earnings
**press release** as Exhibit 99.1 of a Form 8-K under Item 2.02 (Results of
Operations). That is free, timestamped (by filing date), and EDGAR-native — it
carries the headline beat/miss and the company's guidance, which is the
quantifiable core of the earnings-call signal (the live Q&A tone is extra, not
the main driver). This agent is honest that it reads the *press release*, not the
full call transcript; the source is pluggable, so a paid transcript feed can slot
in later behind the same interface.

Pipeline: ticker → recent earnings 8-Ks (Item 2.02 → Ex-99.1 text) → an LLM
classifies each release **as-of its filing date** (sentiment / guidance /
beat-miss, with a citation) → an LLM picks one event-driven strategy from a fixed
DSL → a lookahead-free backtest of the post-earnings drift (PEAD).

Reuses Task 4's backtest contracts (downstream consumer, like Task 5/6/7/10).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import (
    BacktestMetrics,
    BacktestResult,
    EquityPoint,
    PricePoint,
    Stance,
    Trade,
)

__all__ = [
    "EarningsEvent",
    "EarningsEntrySignal",
    "EarningsExitSignal",
    "Stance",
    "EarningsSpec",
    "EarningsResult",
    "Task8Job",
    "PricePoint",
    "Trade",
    "EquityPoint",
    "BacktestMetrics",
    "BacktestResult",
]

EventSentiment = Literal["bullish", "neutral", "bearish"]
GuidanceDirection = Literal["raised", "maintained", "lowered", "none"]
BeatMiss = Literal["beat", "inline", "miss", "unknown"]


class EarningsEvent(BaseModel):
    """One classified earnings release. The classification uses ONLY the release
    text (available at filing_date), so it is lookahead-free."""

    filing_date: date              # 8-K filing date — the lookahead boundary for this event
    sentiment: EventSentiment = "neutral"
    guidance: GuidanceDirection = "none"
    beat_miss: BeatMiss = "unknown"
    quote: str = ""                # short supporting excerpt from the press release


# --- Executable earnings DSL ------------------------------------------------
EarningsEntrySignal = Literal[
    "any_earnings",            # enter after every earnings release (pure PEAD test)
    "bullish",                 # enter only after a bullish-sentiment release
    "bullish_or_raised",       # enter after bullish OR raised-guidance releases
    "beat",                    # enter only after a clear earnings beat
]
EarningsExitSignal = Literal[
    "time_exit",               # exit holding_days after entry (the drift horizon)
    "next_earnings",           # hold until the next earnings release
]


class EarningsSpec(BaseModel):
    """A fully-specified, executable earnings strategy. Produced by the LLM."""

    entry_signal: EarningsEntrySignal
    exit_signal: EarningsExitSignal = "time_exit"
    holding_days: int = 30         # post-earnings drift horizon

    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

    stance: Stance = "neutral"
    thesis: str = ""
    rationale_entry: str = ""
    rationale_exit: str = ""


class EarningsResult(BaseModel):
    """Top-level Task 8 output."""

    job_id: str
    ticker: str
    company_name: str | None = None
    cik: int | None = None
    as_of_date: date

    n_releases: int = 0
    events: list[EarningsEvent] = Field(default_factory=list)
    source: str = "sec_8k_item202_ex991"   # the (pluggable) release source

    prices: list[PricePoint]
    strategy: EarningsSpec
    backtest: BacktestResult
    earnings_readings: dict[str, float | str] = Field(default_factory=dict)

    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task8Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: EarningsResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
