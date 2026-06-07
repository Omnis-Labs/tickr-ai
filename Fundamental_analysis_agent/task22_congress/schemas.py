"""Task 22 — congressional-trading agent.

US lawmakers must disclose their securities trades under the STOCK Act, via
Periodic Transaction Reports (PTRs) filed up to 45 days after the trade. We key
every signal to the DISCLOSURE date (never the trade date), so the agent only acts
on what was public at the time — lookahead-free.

Data is pluggable (`congress_data.py`): a paid provider (Quiver / FMP) when an API
key is present, else a best-effort free parse of the House Clerk's PTR PDFs (partial
coverage, House-only — caveated). Reuses Task 17's generic factor backtest.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from shared.schemas import JobStatus
from task4_technical.schemas import BacktestResult, EquityPoint, PricePoint, Stance, Trade

__all__ = ["CongressTrade", "CongressEntrySignal", "Stance", "CongressSpec", "CongressResult",
           "Task22Job", "PricePoint", "Trade", "EquityPoint", "BacktestResult"]


class CongressTrade(BaseModel):
    disclosure_date: date              # the lookahead boundary — when the trade became public
    transaction_date: date | None = None
    member: str = ""
    chamber: Literal["house", "senate", "unknown"] = "unknown"
    txn_type: Literal["buy", "sell", "exchange"] = "buy"
    amount_low: float = 0.0            # USD range low (PTRs disclose a bracket, not an exact size)
    amount_high: float = 0.0
    note: str = ""


CongressEntrySignal = Literal[
    "buy_and_hold",
    "follow_buys",          # long for a window after a disclosed congressional BUY
    "avoid_after_sells",    # stand aside for a window after a disclosed congressional SELL
]


class CongressSpec(BaseModel):
    entry_signal: CongressEntrySignal
    holding_days: int = 90             # drift horizon after a disclosed buy
    sell_window_days: int = 90         # how long to stand aside after a disclosed sell
    stop_loss_pct: float = 0.0
    stance: Stance = "neutral"
    thesis: str = ""
    rationale: str = ""


class CongressResult(BaseModel):
    job_id: str
    ticker: str
    company_name: str | None = None
    as_of_date: date
    provider: str = ""                 # which data source supplied the trades
    n_trades: int = 0
    trades_recent: list[CongressTrade] = Field(default_factory=list)
    prices: list[PricePoint]
    strategy: CongressSpec
    backtest: BacktestResult
    congress_readings: dict[str, float | str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    cost_usd: float = 0.0
    created_at: datetime


class Task22Job(BaseModel):
    job_id: str
    ticker: str
    status: JobStatus
    result: CongressResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
