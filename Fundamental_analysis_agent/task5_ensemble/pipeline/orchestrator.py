"""Task 5 orchestrator — ticker → fundamental + technical legs → arbiter → combined backtest.

Design (see ADR-008):
  * Prices are fetched **once** and shared by both legs + the combined backtest,
    so the ensemble adds no extra yfinance load over a single agent (the sub-agent
    *pipelines* are deliberately NOT reused here — only their building blocks —
    precisely to avoid 3× redundant price fetches).
  * Both legs are authored **concurrently**. The technical leg is the backbone
    (always required); the fundamental leg degrades gracefully — a missing /
    foreign / quarantined 10-K drops the ensemble to a technical-only deferral
    with a loud caveat, rather than failing the whole job.
  * Both legs are re-backtested over one **common window** (`common_start =
    max(technical trailing-window start, fundamental filing-available date)`), so
    their daily positions live on the same timeline and the combined position is
    lookahead-aligned to a single boundary.
  * The arbiter sees each leg's forward reasoning but NOT its realized returns,
    keeping the combine-policy selection out-of-sample.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger

from task2_10k_extractor.eval.edgar_lookup import resolve_filing
from task2_10k_extractor.pipeline.orchestrator import run_pipeline
from task3_strategy.pipeline.autoresearch import author_strategy
from task3_strategy.pipeline.backtest import run_backtest as run_fund_backtest
from task3_strategy.pipeline.prices import fetch_prices
from task4_technical.pipeline.autoresearch import author_technical
from task4_technical.pipeline.backtest import run_backtest as run_tech_backtest
from task4_technical.pipeline.indicators import indicator_readings_asof, readings_block

from task5_ensemble.pipeline.arbiter import arbitrate, single_leg_policy
from task5_ensemble.pipeline.combine import (
    combined_exposure,
    inmarket_by_date,
    run_ensemble_backtest,
)
from task5_ensemble.schemas import EnsembleResult, SubAgentSummary

logger = get_logger(__name__)

_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3       # technical trailing window (matches Task 4)
_MIN_BARS = 200                          # enough history for SMA200 + a window
_LEG_BUDGET_USD = 0.10


class TickerNotFound(ValueError):
    """Raised when the ticker resolves to no usable price history."""


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch(ticker: str) -> list:
    """Blocking yfinance fetch, off the event loop + time-bounded (mirrors Task 3/4)."""
    return await asyncio.wait_for(asyncio.to_thread(fetch_prices, ticker), timeout=30)


async def _author_fundamental(*, job_id: str, ticker: str, prices: list, first_date: date):
    """Resolve → extract → author the fundamental leg. Returns
    (spec, available_date, company_name) or raises to signal 'leg unavailable'."""
    ref = await resolve_filing(ticker)            # KeyError → no 10-K filer
    filing_date = date.fromisoformat(ref.filed_date)
    extraction = await run_pipeline(url=ref.url, job_id=job_id, enable_l3=False)
    if extraction.quarantined:
        raise RuntimeError(
            "10-K extraction quarantined (" + "; ".join(extraction.quarantine_reasons[:2]) + ")"
        )
    available = max(filing_date, first_date)
    spec = await author_strategy(
        trace_id=job_id, ticker=ticker, extraction=extraction,
        prices=prices, filing_date=available, budget_usd=_LEG_BUDGET_USD,
    )
    company = extraction.filing.company_name or ticker
    return spec, available, company


async def _author_technical(*, job_id: str, ticker: str, prices: list, as_of: date):
    readings = indicator_readings_asof(prices, as_of)
    spec = await author_technical(
        trace_id=job_id, ticker=ticker, company=ticker,
        prices=prices, as_of=as_of, readings=readings, budget_usd=_LEG_BUDGET_USD,
    )
    return spec, readings


def _citations_block(spec) -> str:
    cites = getattr(spec, "citations", []) or []
    if not cites:
        return "(no 10-K citations provided)"
    return "\n".join(f"- Item {c.item_id} ({c.item_title}): {c.quote}"[:300] for c in cites[:6])


async def run_ensemble_pipeline(*, ticker: str, job_id: str | None = None) -> EnsembleResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    ticker = ticker.strip().upper()

    # ----- prices (once, shared by both legs + the combined backtest) -----
    try:
        prices = await _fetch(ticker)
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"price fetch for {ticker} timed out after 30s — Yahoo Finance is likely "
            f"rate-limiting this host. Retry, or switch the price source."
        )
    except RuntimeError:
        raise TickerNotFound(
            f"Ticker '{ticker}' returned no price history. Use a US-listed ticker with a "
            f"liquid price history (e.g. AAPL, MSFT, NVDA)."
        )
    if len(prices) < _MIN_BARS:
        raise RuntimeError(
            f"only {len(prices)} trading days of price history for {ticker} — too little "
            f"for an ensemble backtest (need ≥ {_MIN_BARS})."
        )
    as_of = prices[-1].date
    first_date = prices[0].date
    tech_start = max(first_date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))
    logger.info("task5_resolved", ticker=ticker, as_of=as_of.isoformat(), bars=len(prices))

    # ----- market benchmark (SPY) — best-effort, never fatal -----
    market_prices = None
    if ticker != "SPY":
        try:
            market_prices = await _fetch("SPY")
        except Exception as e:  # noqa: BLE001
            logger.warning("task5_spy_fetch_failed", error=str(e)[:160])

    # ----- author both legs concurrently (technical = backbone; fundamental optional) -----
    tech_res, fund_res = await asyncio.gather(
        _author_technical(job_id=job_id, ticker=ticker, prices=prices, as_of=as_of),
        _author_fundamental(job_id=job_id, ticker=ticker, prices=prices, first_date=first_date),
        return_exceptions=True,
    )
    if isinstance(tech_res, BaseException):
        raise RuntimeError(f"technical leg failed: {tech_res}") from tech_res
    tech_spec, readings = tech_res

    fund_spec = fund_available = company = None
    fund_note = ""
    if isinstance(fund_res, BaseException):
        fund_note = str(fund_res)[:200] if not isinstance(fund_res, KeyError) else (
            f"no 10-K filer for {ticker} (foreign filers file 20-F, not 10-K)"
        )
        logger.info("task5_fundamental_unavailable", ticker=ticker, reason=fund_note[:120])
    else:
        fund_spec, fund_available, company = fund_res
    company = company or ticker

    # ----- common window: a single lookahead boundary for both legs -----
    common_start = max(tech_start, fund_available) if fund_available else tech_start
    if fund_spec is not None and len([p for p in prices if p.date >= common_start]) < _MIN_BARS // 4:
        # Fundamental filing is so recent the overlap is too short to be meaningful;
        # drop it rather than backtest a handful of bars.
        fund_note = (
            f"10-K filing date leaves only a short overlap window; fundamental leg dropped "
            f"to keep the backtest meaningful."
        )
        logger.info("task5_fundamental_dropped_short_overlap", ticker=ticker)
        fund_spec = fund_available = None
        common_start = tech_start

    dates = [p.date for p in prices if p.date >= common_start]
    if len(dates) < 2:
        raise RuntimeError("insufficient overlapping price history for an ensemble backtest")

    # ----- re-backtest each leg over the SAME common window -----
    tech_bt = run_tech_backtest(prices, tech_spec, start=common_start,
                                transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    tech_in = inmarket_by_date(tech_bt.trades, dates)

    if fund_spec is not None:
        fund_bt = run_fund_backtest(prices, fund_spec, start=common_start,
                                    transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
        fund_in = inmarket_by_date(fund_bt.trades, dates)
    else:
        fund_bt = None
        fund_in = {d: False for d in dates}

    # ----- arbiter: pick a combine policy (LLM if both legs present) -----
    if fund_spec is not None:
        policy = await arbitrate(
            trace_id=job_id, ticker=ticker,
            fund_stance=fund_spec.stance, fund_entry=fund_spec.entry_signal,
            fund_exit=fund_spec.exit_signal, fund_thesis=fund_spec.thesis[:1000],
            fund_citations=_citations_block(fund_spec),
            tech_stance=tech_spec.stance, tech_entry=tech_spec.entry_signal,
            tech_exit=tech_spec.exit_signal, tech_thesis=tech_spec.thesis[:1000],
            tech_readings=readings_block(readings),
            budget_usd=_LEG_BUDGET_USD,
        )
    else:
        policy = single_leg_policy(available="technical")

    # ----- combine → combined-position backtest -----
    exposure = combined_exposure(
        fund_in=fund_in, tech_in=tech_in, dates=dates,
        combine_mode=policy.combine_mode,
        fundamental_weight=policy.fundamental_weight,
        technical_weight=policy.technical_weight,
        fundamental_stance=(fund_spec.stance if fund_spec is not None else "neutral"),
    )
    ensemble_bt = run_ensemble_backtest(
        prices, exposure, start=common_start,
        transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices,
    )

    # ----- assemble leg summaries (returns shown to the USER, just not the arbiter) -----
    fundamental = SubAgentSummary(
        agent="fundamental",
        available=fund_spec is not None,
        stance=(fund_spec.stance if fund_spec is not None else None),
        entry_signal=(fund_spec.entry_signal if fund_spec is not None else None),
        exit_signal=(fund_spec.exit_signal if fund_spec is not None else None),
        thesis=(fund_spec.thesis if fund_spec is not None else ""),
        total_return_pct=(fund_bt.metrics.total_return_pct if fund_bt else None),
        excess_vs_market_pct=(fund_bt.metrics.excess_vs_market_pct if fund_bt else None),
        sharpe=(fund_bt.metrics.sharpe if fund_bt else None),
        n_trades=(fund_bt.metrics.n_trades if fund_bt else None),
        note=fund_note,
    )
    technical = SubAgentSummary(
        agent="technical",
        available=True,
        stance=tech_spec.stance, entry_signal=tech_spec.entry_signal,
        exit_signal=tech_spec.exit_signal, thesis=tech_spec.thesis,
        total_return_pct=tech_bt.metrics.total_return_pct,
        excess_vs_market_pct=tech_bt.metrics.excess_vs_market_pct,
        sharpe=tech_bt.metrics.sharpe, n_trades=tech_bt.metrics.n_trades,
    )

    chart_from = common_start - timedelta(days=_CHART_LOOKBACK_DAYS)
    chart_prices = [p for p in prices if p.date >= chart_from]

    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical ensemble backtest over a common window starting {common_start.isoformat()} "
        f"(lookahead boundary) and ending {as_of.isoformat()}. Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps charged on rebalance turnover "
        f"(|Δexposure|); slippage and market impact are not.",
        "Two agents are fused: a fundamental agent (Task 3, grounded in the latest 10-K) and a "
        "technical agent (Task 4, grounded in as-of indicator readings). An LLM arbiter chose the "
        "combination policy from a FIXED menu using each agent's forward-looking reasoning ONLY — "
        "it was NOT shown either agent's realized returns, so the policy is not fit to the test "
        "window. Execution is fully deterministic.",
        "The 'fundamental' / 'technical' return columns are each agent re-backtested over this same "
        "common window, so they are directly comparable to the ensemble — but rule-based execution "
        "still cannot rule out that the strategy *selection* reflects the model's prior knowledge.",
    ]
    if not fundamental.available:
        caveats.insert(1, f"⚠️ Fundamental leg unavailable — {fund_note}. Ensemble is technical-only "
                          f"(policy: {policy.combine_mode}).")

    logger.info(
        "task5_done", ticker=ticker, mode=policy.combine_mode, stance=policy.resolved_stance,
        ens_ret=ensemble_bt.metrics.total_return_pct, ens_alpha=ensemble_bt.metrics.excess_vs_market_pct,
        ms=int((time.perf_counter() - started) * 1000),
    )

    return EnsembleResult(
        job_id=job_id,
        ticker=ticker,
        company_name=company,
        common_window_start=common_start,
        as_of_date=as_of,
        fundamental=fundamental,
        technical=technical,
        policy=policy,
        backtest=ensemble_bt,
        prices=chart_prices,
        caveats=caveats,
        cost_usd=round(cost, 6),
        created_at=datetime.now(timezone.utc),
    )
