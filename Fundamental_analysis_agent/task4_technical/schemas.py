"""Typed contracts for Task 4 — technical-analysis-driven strategy lab.

The pipeline is: a ticker's price history → deterministic technical indicator
readings computed strictly *as-of* the most recent close → an LLM that selects
one executable strategy from a fixed technical menu, grounded in those readings
→ a trailing-window, lookahead-free backtest of that strategy.

Like Task 3, the DSL is deliberately small and deterministic. The LLM chooses
*which* strategy + parameters and writes a rationale citing the readings; it
never emits free-form code. That is what keeps the backtest lookahead-free: an
LLM that has seen later prices in training still cannot leak them into a
deterministic SMA/MACD/Donchian rule.

This module is standalone — it intentionally re-declares the backtest contracts
(Trade, EquityPoint, BacktestMetrics, BacktestResult) rather than importing
Task 3's, so the two agents stay decoupled. `PricePoint` is the one exception:
it is imported from Task 3 so the shared `fetch_prices` return type matches.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task3_strategy.schemas import PricePoint  # shared with the reused fetch_prices

__all__ = [
    "TechEntrySignal",
    "TechExitSignal",
    "Stance",
    "TechnicalSpec",
    "PricePoint",
    "Trade",
    "EquityPoint",
    "BacktestMetrics",
    "BacktestResult",
    "TechnicalResult",
    "Task4Job",
]

# --- Executable technical strategy DSL --------------------------------------

TechEntrySignal = Literal[
    "buy_and_hold",
    "sma_cross",
    "macd_cross",
    "rsi_oversold",
    "bollinger_breakout",
    "donchian_breakout",
    "momentum",
]
TechExitSignal = Literal[
    "hold",
    "sma_reverse",
    "macd_reverse",
    "rsi_overbought",
    "bollinger_revert",
    "donchian_stop",
    "time_exit",
]
Stance = Literal["bullish", "neutral", "cautious"]


class TechnicalSpec(BaseModel):
    """A fully-specified, executable technical strategy. Produced by the LLM,
    consumed by the backtest engine without further interpretation."""

    entry_signal: TechEntrySignal
    exit_signal: TechExitSignal = "hold"

    # Parameter bag — only keys relevant to the chosen signals are read.
    sma_fast: int = 20
    sma_slow: int = 50
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    rsi_period: int = 14
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0
    bollinger_period: int = 20
    bollinger_k: float = 2.0
    donchian_period: int = 20
    momentum_lookback_days: int = 60
    momentum_threshold_pct: float = 5.0
    time_exit_days: int = 120

    # Volume-confirmation overlay — when set, an entry only fires if the
    # short-window average volume is at least `volume_confirm_ratio`× the
    # long-window average (i.e. the move is backed by participation).
    require_volume_confirm: bool = False
    volume_fast: int = 20
    volume_slow: int = 50
    volume_confirm_ratio: float = 1.0

    # Risk overlay, applied on top of any strategy (0 = disabled).
    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

    # Research artefacts — why this strategy, grounded in the indicator readings.
    stance: Stance = "neutral"
    thesis: str = ""
    rationale_entry: str = ""
    rationale_exit: str = ""


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
    benchmark: float      # buy-and-hold of the same stock from the window start
    market: float | None = None   # buy-and-hold of S&P 500 (SPY) over the same window


class BacktestMetrics(BaseModel):
    total_return_pct: float
    benchmark_return_pct: float          # buy-and-hold over the FULL window (from window start)
    excess_return_pct: float             # strategy − full-window benchmark
    # Entry-aligned benchmark: buy-and-hold from the strategy's FIRST entry to
    # the end. Isolates timing/signal quality from the cash-drag of the
    # indicator warm-up period (when the strategy structurally cannot trade).
    # None when the strategy never entered.
    benchmark_from_entry_pct: float | None = None
    excess_vs_entry_pct: float | None = None   # strategy − entry-aligned benchmark
    # Market (S&P 500 via SPY) buy-and-hold over the same window, and the
    # strategy's alpha against it. None if SPY data was unavailable.
    market_return_pct: float | None = None
    excess_vs_market_pct: float | None = None  # strategy − market = alpha vs market
    cagr_pct: float
    sharpe: float                        # annualised, rf=0
    max_drawdown_pct: float
    win_rate_pct: float
    n_trades: int
    exposure_pct: float                  # fraction of days in-market
    days: int
    transaction_cost_bps: float


class BacktestResult(BaseModel):
    start_date: date                     # backtest window start (lookahead boundary)
    end_date: date
    metrics: BacktestMetrics
    trades: list[Trade]
    equity_curve: list[EquityPoint]


class TechnicalResult(BaseModel):
    """Top-level Task 4 output."""

    job_id: str
    ticker: str
    company_name: str | None = None
    # The decision/lookahead boundary: indicator readings the LLM saw are
    # computed strictly on/before this date (the most recent close).
    as_of_date: date

    prices: list[PricePoint]             # OHLCV for the candlestick chart
    strategy: TechnicalSpec
    backtest: BacktestResult
    # The exact as-of indicator readings the LLM was given — surfaced in the UI
    # for transparency (str|float values; e.g. "trend_regime": "uptrend").
    indicator_readings: dict[str, float | str] = Field(default_factory=dict)

    # Honest, always-on disclaimers surfaced in the UI.
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task4Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: TechnicalResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
