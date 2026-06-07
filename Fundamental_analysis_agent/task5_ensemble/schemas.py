"""Typed contracts for Task 5 — ensemble / multi-agent arbitration.

The pipeline is: one ticker → run the fundamental agent (Task 3) and the
technical agent (Task 4) over a *common* trailing window → an LLM **arbiter**
that reads both agents' stances + theses + signals (but NOT their realized
backtest returns) and selects one deterministic *combination policy* from a
fixed menu → a single combined-position backtest of that policy, lookahead-aligned
to the common window.

Why withhold realized returns from the arbiter (ADR-008): Task 3 and Task 4 both
author their strategy *before* the backtest runs, so the selection can't be fit
to the test window. The ensemble keeps that discipline — the arbiter chooses how
to *combine* the two agents from their forward-looking reasoning only; the
combined backtest is then the out-of-sample check on that choice.

Task 5 is an *aggregator*: unlike Task 3/4 (which deliberately stay decoupled and
re-declare their backtest contracts), this module openly depends on both lower
agents and reuses Task 4's backtest contracts rather than re-declaring them.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus

# Reuse Task 4's already-shared execution contracts (which themselves reuse
# Task 3's PricePoint). Task 5 sits on top of both agents, so the decoupling
# rationale that made Task 4 re-declare these does not apply here.
from task4_technical.schemas import (
    BacktestMetrics,
    BacktestResult,
    EquityPoint,
    PricePoint,
    Stance,
    Trade,
)

__all__ = [
    "CombineMode",
    "Agreement",
    "Stance",
    "EnsemblePolicy",
    "SubAgentSummary",
    "EnsembleResult",
    "Task5Job",
    "PricePoint",
    "Trade",
    "EquityPoint",
    "BacktestMetrics",
    "BacktestResult",
]

# --- Combination DSL --------------------------------------------------------
# The arbiter picks exactly one of these. Each maps to a deterministic daily
# target-exposure rule in `pipeline/combine.py` — the LLM never emits exposure
# numbers directly, only the policy + (for `weighted`) the leg weights.
CombineMode = Literal[
    "and",                            # long only when BOTH legs are long
    "or",                             # long when EITHER leg is long
    "weighted",                       # exposure = fw·fund + tw·tech (clamped 0..1)
    "fundamental_gated_technical",    # follow technical timing, sized by fundamental conviction
    "defer_fundamental",              # ignore technical, follow the fundamental leg
    "defer_technical",                # ignore fundamental, follow the technical leg
]

# How the two agents related, for UI + auditing.
Agreement = Literal["agree", "conflict", "partial", "single_leg"]


class EnsemblePolicy(BaseModel):
    """The arbiter's decision: how to fuse the two agents. Produced by the LLM
    (or a deterministic fallback), consumed by the combine engine verbatim."""

    combine_mode: CombineMode
    # Only read when combine_mode == "weighted"; clamped to [0,1] and used as-is
    # (the combined exposure is clamped to [0,1], so weights summing >1 just
    # saturate to fully-invested when both legs are long).
    fundamental_weight: float = 0.5
    technical_weight: float = 0.5

    # The arbiter's resolved house view + how it reconciled the two agents.
    resolved_stance: Stance = "neutral"
    agreement: Agreement = "partial"
    arbitration_thesis: str = ""
    conflict_resolution: str = ""


class SubAgentSummary(BaseModel):
    """A compact, UI-facing summary of one leg. Realized returns ARE shown here
    (to the user, after the fact) — they are only withheld from the *arbiter's*
    prompt, per ADR-008."""

    agent: Literal["fundamental", "technical"]
    available: bool
    stance: Stance | None = None
    entry_signal: str | None = None
    exit_signal: str | None = None
    thesis: str = ""
    # Standalone performance of this leg over the SAME common window, so the UI
    # can show "ensemble vs each agent alone". None when the leg is unavailable.
    total_return_pct: float | None = None
    excess_vs_market_pct: float | None = None    # alpha vs S&P 500
    sharpe: float | None = None
    n_trades: int | None = None
    # Why a leg is unavailable (e.g. "no 10-K / quarantined"), surfaced in the UI.
    note: str = ""


class EnsembleResult(BaseModel):
    """Top-level Task 5 output."""

    job_id: str
    ticker: str
    company_name: str | None = None

    # The single lookahead boundary for the whole ensemble: every leg's signals
    # and the combined position only act on or after this date.
    common_window_start: date
    as_of_date: date

    fundamental: SubAgentSummary
    technical: SubAgentSummary
    policy: EnsemblePolicy

    # The combined-position backtest — the headline artefact.
    backtest: BacktestResult

    prices: list[PricePoint]                       # OHLCV for the candlestick chart
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task5Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: EnsembleResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
