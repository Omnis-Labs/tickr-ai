"""Typed contracts for Task 7 — peer/sector relative-strength agent.

The pipeline is: a ticker → its sector ETF (SIC-derived, SPY fallback) → a
deterministic *relative-strength* series (ticker price ÷ benchmark price)
computed strictly as-of the most recent close → an LLM that picks one strategy
from a fixed RS menu, grounded in the as-of readings → a lookahead-free backtest
that holds the TICKER (long/flat) but whose signals come from relative strength.

Like Task 4, the LLM only chooses *which* RS signal + parameters; execution is
deterministic and signals act on the next bar's open. Reuses Task 4's backtest
contracts (downstream consumer, like Task 5/6).
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
    "RelEntrySignal",
    "RelExitSignal",
    "Stance",
    "RelativeSpec",
    "RelativeResult",
    "Task7Job",
    "PricePoint",
    "Trade",
    "EquityPoint",
    "BacktestMetrics",
    "BacktestResult",
]

# --- Executable relative-strength DSL --------------------------------------
RelEntrySignal = Literal[
    "buy_and_hold",     # baseline: enter at window start, hold
    "rs_uptrend",       # long while RS ratio > its SMA (outperforming the sector)
    "rs_breakout",      # long when RS ratio makes a new rs_high_lookback-day high
    "rs_momentum",      # long when relative return over the lookback >= threshold
]
RelExitSignal = Literal[
    "hold",
    "rs_downtrend",     # exit when RS ratio < its SMA (losing relative strength)
    "time_exit",
]


class RelativeSpec(BaseModel):
    """A fully-specified, executable relative-strength strategy."""

    entry_signal: RelEntrySignal
    exit_signal: RelExitSignal = "rs_downtrend"

    rs_sma: int = 50                       # SMA window over the RS ratio
    rs_high_lookback: int = 60             # breakout lookback over the RS ratio
    rs_momentum_lookback_days: int = 90    # relative-return window
    rs_momentum_threshold_pct: float = 0.0 # >= 0 means "must be outperforming"
    holding_days: int = 120

    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

    stance: Stance = "neutral"
    thesis: str = ""
    rationale_entry: str = ""
    rationale_exit: str = ""


class RelativeResult(BaseModel):
    """Top-level Task 7 output."""

    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date

    sector_etf: str = "SPY"                # benchmark used for relative strength
    sector_label: str = "Market (S&P 500)"

    prices: list[PricePoint]               # the TICKER's OHLCV for the chart
    strategy: RelativeSpec
    backtest: BacktestResult
    relative_readings: dict[str, float | str] = Field(default_factory=dict)

    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task7Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: RelativeResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
