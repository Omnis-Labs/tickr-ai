"""Task 24 orchestrator — (bellwether, peer) → bellwether earnings → read-across rule → peer backtest."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map, fetch_submissions
from task3_strategy.pipeline.prices import fetch_prices
from task8_earnings.pipeline.classify import classify_events
from task8_earnings.pipeline.filings import fetch_earnings_releases
from task17_quality.pipeline.backtest import run_factor_backtest   # reused generic factor backtest
from task24_contagion.pipeline.autoresearch import author_contagion
from task24_contagion.pipeline.contagion import (
    contagion_readings, make_want_long, readings_block, split_dates,
)
from task24_contagion.schemas import ContagionResult

logger = get_logger(__name__)
_TXN_COST_BPS = 10.0
_CHART_LOOKBACK_DAYS = 365
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 250
_LEG_BUDGET_USD = 0.12


class TickerNotFound(ValueError):
    pass


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def _fetch(t: str) -> list:
    return await asyncio.wait_for(asyncio.to_thread(fetch_prices, t), timeout=30)


async def _safe(t: str) -> list | None:
    try:
        return await _fetch(t)
    except Exception:  # noqa: BLE001
        return None


async def run_contagion_pipeline(*, bellwether: str, peer: str, job_id: str | None = None) -> ContagionResult:
    job_id = job_id or new_job_id()
    started = time.perf_counter()
    bell, pr = bellwether.strip().upper(), peer.strip().upper()
    if bell == pr:
        raise TickerNotFound("bellwether and peer must be different tickers (e.g. AVGO, MRVL).")
    try:
        peer_prices = await _fetch(pr)
    except asyncio.TimeoutError:
        raise RuntimeError(f"price fetch for {pr} timed out after 30s — retry.")
    except RuntimeError:
        raise TickerNotFound(f"Peer '{pr}' returned no price history. Use a US-listed ticker.")
    if len(peer_prices) < _MIN_BARS:
        raise RuntimeError(f"only {len(peer_prices)} trading days for {pr} — too little.")
    as_of = peer_prices[-1].date
    backtest_start = max(peer_prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))
    market_prices = None if pr == "SPY" else await _safe("SPY")

    no_data = ""
    events = []
    try:
        cik = (await fetch_sec_ticker_map()).get(bell)
        if cik is None:
            no_data = f"{bell} has no US SEC CIK — no earnings 8-Ks for the bellwether."
        else:
            releases, _capped = await fetch_earnings_releases(cik, since=backtest_start - timedelta(days=120))
            events = await classify_events(trace_id=job_id, ticker=bell, releases=releases, budget_usd=_LEG_BUDGET_USD)
    except Exception as e:  # noqa: BLE001
        logger.warning("task24_bellwether_failed", error=str(e)[:200])
        no_data = f"bellwether earnings unavailable for {bell}: {type(e).__name__}."

    dates = split_dates(events)
    readings = contagion_readings(events, dates, as_of, bell)
    spec = await author_contagion(trace_id=job_id, pair=f"{bell} → {pr}",
                                  readings_block=readings_block(readings), budget_usd=_LEG_BUDGET_USD)
    backtest = run_factor_backtest(peer_prices, make_want_long(spec, dates), start=backtest_start,
                                   exit_mode="deteriorating", stop_loss_pct=spec.stop_loss_pct,
                                   transaction_cost_bps=_TXN_COST_BPS, market_prices=market_prices)
    chart = [p for p in peer_prices if p.date >= backtest_start - timedelta(days=_CHART_LOOKBACK_DAYS)]
    recent = [e for e in events if e.filing_date <= as_of][-12:]
    cost = await cost_for_trace(job_id)
    caveats = [
        f"Hypothetical backtest of {pr} (the peer) over the trailing ~3 years ending {as_of.isoformat()} "
        f"(window start {backtest_start.isoformat()}). Not investment advice.",
        "Past performance does not predict future returns.",
        f"Transaction cost modelled at {_TXN_COST_BPS:.0f} bps per side; slippage not modelled.",
        f"The signal trades {pr} off {bell}'s earnings 8-Ks (Item 2.02 / Ex-99.1), LLM-classified for "
        f"sentiment/beat-miss/guidance and keyed to {bell}'s FILING date — so {pr} is only traded on "
        f"information that was public (lookahead-free). Read-across is a SHORT, decaying drift that can "
        f"reverse once {pr} reports its own numbers; long-only (a negative read-across drives avoidance, "
        f"never a short).",
        f"You chose the (bellwether, peer) pairing — there is no automatic peer detection. A weak or "
        f"non-existent industry link between {bell} and {pr} means the signal is noise; judge it on "
        f"whether the pairing is economically real.",
        "Benchmarks: buy-and-hold of the peer and the S&P 500 (SPY).",
    ]
    if no_data:
        caveats.insert(1, f"⚠️ {no_data} No contagion entries fired — flat/buy-and-hold baseline.")
    logger.info("task24_done", bell=bell, peer=pr, entry=spec.entry_signal, n_events=len(events),
                ret=backtest.metrics.total_return_pct, ms=int((time.perf_counter() - started) * 1000))
    return ContagionResult(job_id=job_id, bellwether=bell, peer=pr, company_name=pr, as_of_date=as_of,
                           n_events=len(events), events=recent, prices=chart, strategy=spec, backtest=backtest,
                           contagion_readings=readings, caveats=caveats, cost_usd=round(cost, 6),
                           created_at=datetime.now(timezone.utc))
