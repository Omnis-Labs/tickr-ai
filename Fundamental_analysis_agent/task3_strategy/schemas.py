"""Typed contracts for Task 3 — fundamentals-driven strategy lab.

The pipeline is: a (non-quarantined) Task 2 10-K extraction + the filer's price
history → an LLM-generated *thesis* that selects one executable strategy from a
constrained DSL → a filing-date-aligned backtest of that strategy.

The DSL is deliberately small and deterministic. The LLM chooses *which*
strategy + parameters + a written thesis grounded in the 10-K; it never emits
free-form code. This is what keeps the backtest lookahead-free: an LLM that has
seen post-filing prices in training still cannot leak them into a deterministic
SMA/momentum rule.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus

# --- Executable strategy DSL ------------------------------------------------

EntrySignal = Literal["buy_and_hold", "sma_cross", "momentum", "rsi_oversold"]
ExitSignal = Literal["hold", "sma_reverse", "rsi_overbought", "time_exit"]
Stance = Literal["bullish", "neutral", "cautious"]


class StrategySpec(BaseModel):
    """A fully-specified, executable strategy. Produced by the LLM, consumed by
    the backtest engine without further interpretation."""

    entry_signal: EntrySignal
    exit_signal: ExitSignal = "hold"
    # Parameter bag — only keys relevant to the chosen signals are read.
    sma_fast: int = 20
    sma_slow: int = 50
    momentum_lookback_days: int = 60
    momentum_threshold_pct: float = 5.0
    rsi_period: int = 14
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0
    time_exit_days: int = 120
    # Risk overlay, applied on top of any strategy (0 = disabled).
    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

    # Research artefacts — why this strategy, grounded in the 10-K.
    stance: Stance = "neutral"
    thesis: str = ""
    rationale_entry: str = ""
    rationale_exit: str = ""
    # Each citation references a 10-K item the thesis leans on.
    citations: list["ThesisCitation"] = Field(default_factory=list)


class ThesisCitation(BaseModel):
    item_id: str          # e.g. "1A", "7"
    item_title: str       # e.g. "Risk Factors"
    quote: str            # short supporting excerpt from the extracted item


class PricePoint(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float


class Trade(BaseModel):
    entry_date: date
    entry_price: float
    exit_date: date | None = None
    exit_price: float | None = None
    return_pct: float | None = None      # net of costs
    exit_reason: str = ""                 # "signal" | "stop_loss" | "take_profit" | "time_exit" | "end_of_data"


class EquityPoint(BaseModel):
    date: date
    strategy: float       # portfolio value, starts at 1.0
    benchmark: float      # buy-and-hold of the same stock from filing date


class BacktestMetrics(BaseModel):
    total_return_pct: float
    benchmark_return_pct: float          # buy-and-hold over the FULL window (from filing date)
    excess_return_pct: float             # strategy − full-window benchmark
    # Entry-aligned benchmark: buy-and-hold from the strategy's FIRST entry to
    # the end. Isolates timing/signal quality from the cash-drag of the
    # indicator warm-up period (when the strategy structurally cannot trade).
    # None when the strategy never entered.
    benchmark_from_entry_pct: float | None = None
    excess_vs_entry_pct: float | None = None   # strategy − entry-aligned benchmark
    cagr_pct: float
    sharpe: float                        # annualised, rf=0
    max_drawdown_pct: float
    win_rate_pct: float
    n_trades: int
    exposure_pct: float                  # fraction of days in-market
    days: int
    transaction_cost_bps: float


class BacktestResult(BaseModel):
    start_date: date                     # filing-availability date (lookahead boundary)
    end_date: date
    metrics: BacktestMetrics
    trades: list[Trade]
    equity_curve: list[EquityPoint]


class StrategyResult(BaseModel):
    """Top-level Task 3 output."""

    job_id: str
    ticker: str
    company_name: str | None = None
    filing_url: str
    fiscal_year: int | None = None
    # The lookahead boundary: signals may only act on/after this date. Defaults
    # to the 10-K filing date; falls back to first available price if unknown.
    filing_available_date: date

    prices: list[PricePoint]             # OHLCV for the candlestick chart
    strategy: StrategySpec
    backtest: BacktestResult

    # Honest, always-on disclaimers surfaced in the UI.
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task3Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: StrategyResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


StrategySpec.model_rebuild()
