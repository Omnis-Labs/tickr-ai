"""Deterministic combination engine for the ensemble agent. Pure, lookahead-free.

Two sub-strategies (fundamental = Task 3, technical = Task 4) are each backtested
over the SAME common window, producing one set of `Trade`s each. From those we
derive a daily *in-market* boolean per leg, fuse them into a daily **target
exposure** in [0,1] according to the arbiter's `EnsemblePolicy`, and run a
fractional, daily-rebalanced backtest of that exposure series.

Lookahead discipline is identical to Task 3/4: the target exposure for a bar is
decided on the **close of the prior bar** and executed at the **open of the
current bar**. A transaction cost is charged on the *turnover* (|Δexposure|) of
every rebalance, so an all-or-nothing (0↔1) ensemble pays the same per-side cost
as the underlying single-agent backtests, and partial weightings pay
proportionally.

The metrics (Sharpe, drawdown, alpha vs S&P 500, entry-aligned benchmark) are
computed by Task 4's `_metrics`, reused verbatim so the ensemble's numbers are
defined identically to the legs it is compared against.

KNOWN BOUNDARY — intrabar risk overlays are not preserved. The ensemble operates
on *daily* target exposures derived from each leg's in-market days, so it can only
rebalance at the open. A sub-strategy's intrabar stop-loss / take-profit (which
fills mid-bar at the trigger level) cannot be represented: on the leg's stop day
the ensemble simply goes flat at the next open instead. Therefore
`defer_technical` reproduces the technical leg *exactly* only when that leg has no
stop/take overlay (pinned by test_defer_technical_reproduces_technical_backtest);
for a leg that DOES stop out intrabar, the combined backtest will drift from the
leg's standalone result (the eval records this drift rather than treating it as a
bug). This is an accepted property of a daily-rebalanced combination overlay.
"""

from __future__ import annotations

from datetime import date

# Reuse Task 4's metrics so the ensemble is scored on exactly the same ruler as
# the technical leg it is benchmarked against. `_metrics` is module-private but
# Task 5 is a deliberate consumer of Task 4 (see schemas.py).
from task4_technical.pipeline.backtest import _metrics
from task4_technical.schemas import (
    BacktestResult,
    EquityPoint,
    PricePoint,
    Trade,
)

# Fundamental-conviction multiplier for `fundamental_gated_technical`: the
# technical timing is sized by how strongly the fundamental leg leans.
_STANCE_MULT = {"bullish": 1.0, "neutral": 0.5, "cautious": 0.0}

_EPS = 1e-9


def inmarket_by_date(trades: list[Trade], dates: list[date]) -> dict[date, bool]:
    """Daily in-market flag derived from a leg's executed trades.

    A position is held from a trade's `entry_date` (the fill bar) up to but not
    including its `exit_date` — a signal/time exit fills at that day's open, so the
    exit day itself is flat. Two cases extend the hold through the end:
      * an open trade (exit_date is None), and
      * an `end_of_data` exit — that is not a real sell at the last open, just a
        mark-out at the final close, so the position is still held that last day.
    (A stop/take-profit exit fills intrabar on its exit day; modelling the leg as
    flat that day is a deliberate, slight approximation.)
    """
    flags = {d: False for d in dates}
    for t in trades:
        open_ended = t.exit_date is None or t.exit_reason == "end_of_data"
        for d in dates:
            if d >= t.entry_date and (open_ended or d < t.exit_date):
                flags[d] = True
    return flags


def combined_exposure(
    *,
    fund_in: dict[date, bool],
    tech_in: dict[date, bool],
    dates: list[date],
    combine_mode: str,
    fundamental_weight: float,
    technical_weight: float,
    fundamental_stance: str,
) -> dict[date, float]:
    """Fuse the two daily in-market series into a daily target exposure in [0,1].

    All branches are pure functions of the two leg signals (+ a static
    fundamental stance for the gated mode); no future information enters.
    """
    fw = max(0.0, min(1.0, fundamental_weight))
    tw = max(0.0, min(1.0, technical_weight))
    gate = _STANCE_MULT.get(fundamental_stance, 0.5)

    out: dict[date, float] = {}
    for d in dates:
        f = fund_in.get(d, False)
        t = tech_in.get(d, False)
        if combine_mode == "and":
            e = 1.0 if (f and t) else 0.0
        elif combine_mode == "or":
            e = 1.0 if (f or t) else 0.0
        elif combine_mode == "weighted":
            e = fw * (1.0 if f else 0.0) + tw * (1.0 if t else 0.0)
        elif combine_mode == "fundamental_gated_technical":
            e = gate * (1.0 if t else 0.0)
        elif combine_mode == "defer_fundamental":
            e = 1.0 if f else 0.0
        elif combine_mode == "defer_technical":
            e = 1.0 if t else 0.0
        else:  # unknown mode → flat (fail safe, not silent: caller logs the mode)
            e = 0.0
        out[d] = max(0.0, min(1.0, e))
    return out


def run_ensemble_backtest(
    prices: list[PricePoint],
    exposure_by_date: dict[date, float],
    *,
    start: date,
    transaction_cost_bps: float = 10.0,
    market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    """Fractional, daily-rebalanced backtest of a target-exposure series.

    `exposure_by_date` is a *holding* series: its value for day i is the fraction
    of the book to hold THROUGH day i. The series produced by `combined_exposure`
    is built from the legs' executed trades, whose signals were already decided on
    the prior close and filled at the open — so the one-bar execution lag is
    already baked in. The book is therefore rebalanced to that day's target at the
    day's **open** (not lagged a second time), and a transaction cost is charged on
    the |Δexposure| turnover of each rebalance. Bar-0 targets are forced flat so
    the first actionable holding is at opens[1], matching the single-agent engines.
    """
    window = [p for p in prices if p.date >= start]
    if len(window) < 2:
        raise RuntimeError("insufficient price history in the ensemble window")

    opens = [p.open for p in window]
    closes = [p.close for p in window]
    n = len(window)
    cost = transaction_cost_bps / 10_000.0

    # target[i] = fraction to hold THROUGH bar i, rebalanced at the open of bar i.
    # Bar 0 forced flat: the legs cannot fill before opens[1], so neither can the
    # combination, keeping the benchmark anchor (opens[1]) honest.
    target = [0.0] + [max(0.0, min(1.0, exposure_by_date.get(window[i].date, 0.0)))
                      for i in range(1, n)]

    cash = 1.0          # uninvested portion of a $1 book
    shares = 0.0        # invested portion expressed in price-units
    cur_expo = 0.0      # current invested fraction (for episode bookkeeping)
    days_in_market = 0

    # Benchmark + market anchored at the first actionable open (opens[1]), exactly
    # as the single-agent engines do, so buy_and_hold ≡ benchmark to within cost.
    bench_entry = opens[1]
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0

    equity_curve: list[EquityPoint] = []
    # Position episodes (contiguous in-market spans) synthesized as Trades, so
    # win-rate / entry-aligned benchmark are well-defined for a fractional book.
    trades: list[Trade] = []
    episode_start_equity: float | None = None

    equity = 1.0
    for i in range(n):
        # ---- rebalance to today's target holding, at today's open ----
        equity_at_open = cash + shares * opens[i]
        tgt = target[i]
        desired_invested = tgt * equity_at_open
        current_invested = shares * opens[i]
        turnover = abs(desired_invested - current_invested)
        cost_paid = turnover * cost
        shares = desired_invested / opens[i] if opens[i] > 0 else 0.0
        cash = equity_at_open - desired_invested - cost_paid

        # episode bookkeeping for trade synthesis
        was_in, now_in = cur_expo > _EPS, tgt > _EPS
        if now_in and not was_in:
            episode_start_equity = cash + shares * opens[i]
            trades.append(Trade(entry_date=window[i].date, entry_price=round(opens[i], 4)))
        elif was_in and not now_in and trades and episode_start_equity:
            ep_end_equity = cash + shares * opens[i]
            trades[-1].exit_date = window[i].date
            trades[-1].exit_price = round(opens[i], 4)
            trades[-1].return_pct = round((ep_end_equity / episode_start_equity - 1.0) * 100.0, 4)
            trades[-1].exit_reason = "signal"
            episode_start_equity = None
        cur_expo = tgt

        # ---- mark to market at today's close ----
        equity = cash + shares * closes[i]
        if tgt > _EPS:
            days_in_market += 1

        # ---- market (SPY) benchmark, aligned + carry-forward ----
        if mkt_entry:
            if i == 0:
                market_val: float | None = 1.0
            else:
                if window[i].date in mkt_close:
                    last_mkt = mkt_close[window[i].date] / mkt_entry
                market_val = round(last_mkt, 6)
        else:
            market_val = None

        equity_curve.append(
            EquityPoint(
                date=window[i].date,
                strategy=round(equity, 6),
                benchmark=1.0 if i == 0 else round(closes[i] / bench_entry, 6),
                market=market_val,
            )
        )

    # close any still-open episode at the last close for reporting
    if cur_expo > _EPS and trades and trades[-1].exit_date is None and episode_start_equity:
        trades[-1].exit_date = window[-1].date
        trades[-1].exit_price = round(closes[-1], 4)
        trades[-1].return_pct = round((equity / episode_start_equity - 1.0) * 100.0, 4)
        trades[-1].exit_reason = "end_of_data"

    metrics = _metrics(equity_curve, trades, closes, days_in_market, transaction_cost_bps)
    return BacktestResult(
        start_date=window[0].date,
        end_date=window[-1].date,
        metrics=metrics,
        trades=trades,
        equity_curve=equity_curve,
    )
