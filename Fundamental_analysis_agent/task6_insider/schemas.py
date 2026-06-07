"""Typed contracts for Task 6 — insider-transaction (SEC Form 4) agent.

The pipeline is: a ticker → its SEC Form 4 filings (insider transactions) →
deterministic insider-flow readings computed strictly *as-of* a decision date →
an LLM that selects one executable strategy from a fixed insider-signal menu,
grounded in those readings → a lookahead-free, filing-date-aligned backtest.

Lookahead discipline: an insider transaction only becomes *actionable* when its
Form 4 is **filed** (publicly visible), not when the trade happened. Form 4s are
due within two business days, but we always key the signal off the FILING date,
never the transaction date — so a backtest cannot act on an insider trade before
the market could have known about it.

Like Task 3/4, the LLM only chooses *which* signal + parameters and writes a
thesis; execution is deterministic. This module reuses Task 4's backtest
contracts (it is a downstream consumer, like Task 5).
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
    "InsiderTxn",
    "InsiderEntrySignal",
    "InsiderExitSignal",
    "Stance",
    "InsiderSpec",
    "InsiderResult",
    "Task6Job",
    "PricePoint",
    "Trade",
    "EquityPoint",
    "BacktestMetrics",
    "BacktestResult",
]


class InsiderTxn(BaseModel):
    """One parsed non-derivative Form 4 transaction line."""

    filing_date: date            # when the Form 4 became public — the lookahead boundary
    transaction_date: date       # when the trade happened (informational only)
    code: str                    # SEC transaction code: P=open-market buy, S=sale, A=grant, M=option exercise, F=tax, G=gift…
    shares: float
    price: float                 # per-share; 0 for grants/gifts
    acquired_disposed: str       # "A" (acquired) | "D" (disposed)
    is_officer: bool = False
    is_director: bool = False
    is_ten_pct_owner: bool = False
    owner_name: str = ""
    officer_title: str = ""

    @property
    def is_open_market_buy(self) -> bool:
        # Code P = open-market / private purchase, shares acquired. The only
        # unambiguously *discretionary bullish* signal. Grants (A), option
        # exercises (M), tax withholding (F), gifts (G) are excluded.
        return self.code == "P" and self.acquired_disposed == "A"

    @property
    def is_open_market_sale(self) -> bool:
        return self.code == "S" and self.acquired_disposed == "D"

    @property
    def value_usd(self) -> float:
        return self.shares * self.price


# --- Executable insider-signal DSL -----------------------------------------
InsiderEntrySignal = Literal[
    "buy_and_hold",        # baseline: enter at window start, hold
    "any_insider_buy",     # go long after any open-market insider purchase in the lookback
    "cluster_buy",         # go long when >= min_distinct_buyers insiders bought in the lookback
    "net_value_buy",       # go long when net insider $ bought in the lookback >= min_net_value_usd
]
InsiderExitSignal = Literal[
    "hold",                # never exit on signal (pairs with time/stop overlay)
    "time_exit",           # exit holding_days after entry
    "net_sell",            # exit when net insider $ over the lookback turns negative (selling)
]


class InsiderSpec(BaseModel):
    """A fully-specified, executable insider strategy. Produced by the LLM,
    consumed by the backtest engine without further interpretation."""

    entry_signal: InsiderEntrySignal
    exit_signal: InsiderExitSignal = "time_exit"

    # Signal parameters — only those relevant to the chosen signals are read.
    lookback_days: int = 90              # trailing window over filings, by FILING date
    min_distinct_buyers: int = 2         # cluster threshold
    min_net_value_usd: float = 100_000.0 # net $ threshold for net_value_buy
    holding_days: int = 60               # time_exit horizon

    # Risk overlay (0 = disabled).
    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

    # Research artefacts — why this strategy, grounded in the insider readings.
    stance: Stance = "neutral"
    thesis: str = ""
    rationale_entry: str = ""
    rationale_exit: str = ""


class InsiderResult(BaseModel):
    """Top-level Task 6 output."""

    job_id: str
    ticker: str
    company_name: str | None = None
    cik: int | None = None
    # The decision/lookahead boundary: readings the LLM saw use only filings
    # filed on/before this date (the most recent price close).
    as_of_date: date

    n_form4_filings: int = 0             # how many Form 4s were fetched
    n_transactions: int = 0              # parsed non-derivative lines
    fetch_capped: bool = False           # True if we bounded the Form 4 fetch (logged, not silent)

    prices: list[PricePoint]             # OHLCV for the candlestick chart
    strategy: InsiderSpec
    backtest: BacktestResult
    # The exact as-of insider-flow readings the LLM was given (str|float values).
    insider_readings: dict[str, float | str] = Field(default_factory=dict)

    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task6Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: InsiderResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
