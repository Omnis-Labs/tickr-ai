"""Signal Scanner — the 'selection + collaboration' front door, with a DSR credibility filter.

Runs a set of agents across a watchlist and reports, per name, which agents have a LONG signal
*today* (selection), ensembles the real agents into one stance (collaboration), and defaults to
holding SPY when none has conviction. Each agent carries its **Deflated Sharpe Ratio tier** (from
shared/reports/deflated_sharpe.json) so a green dot means "this agent's signal is credible", not
just "it fired":
  • cleared   — DSR > 0.95 (beats the best-of-N placebo fluke) — fully trusted. (currently none)
  • credible  — PSR vs 0 ≥ 0.88 (Sharpe is credibly positive in isolation, not multiple-testing-proven)
  • weak      — neither
The default ensemble counts credible+cleared agents; a "DSR-cleared only" toggle (frontend) drops to
the strict bar (→ everything falls back to SPY today, which is the honest state of the suite).

Real per-name agents: T19 anomaly, T17 quality, T18 events (LLM, best-effort), T22 congress
(provider, best-effort). Market regime: T20 VIX. Placebo reference: T25/T27/T35. Tickers scanned
concurrently; every data fetch is best-effort with its own timeout.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

logger = get_logger(__name__)
router = APIRouter(prefix="/scanner", tags=["scanner"])

AGENTS = [
    ("T19", "T19 · Price anomaly", "real"),
    ("T17", "T17 · Fundamental quality", "real"),
    ("T18", "T18 · Corporate events", "real"),
    ("T22", "T22 · Congressional", "real"),
    ("T20", "T20 · VIX regime", "market"),
    ("T25", "T25 · Astrology", "placebo"),
    ("T27", "T27 · 八字", "placebo"),
    ("T35", "T35 · Jyotiṣa", "placebo"),
]
_REAL = [k for k, _, kind in AGENTS if kind == "real"]
_DSR_PATH = Path(__file__).resolve().parents[2] / "shared" / "reports" / "deflated_sharpe.json"
_JOB_TIMEOUT_S = 200.0


def _dsr_map() -> dict[str, dict]:
    try:
        data = json.loads(_DSR_PATH.read_text())
        return {a["agent"].split()[0]: a for a in data.get("agents", [])}
    except Exception:  # noqa: BLE001
        return {}


def _tier(key: str, dm: dict) -> tuple[str, float | None]:
    info = dm.get(key)
    if not info:
        return "na", None
    dsr = info.get("dsr"); psr = info.get("psr_vs_zero")
    if isinstance(dsr, (int, float)) and dsr >= 0.95:
        return "cleared", dsr
    if isinstance(psr, (int, float)) and psr >= 0.88:
        return "credible", dsr
    return "weak", dsr


class ScanCreate(BaseModel):
    tickers: list[str]


class AgentMeta(BaseModel):
    key: str
    label: str
    kind: str
    tier: str = "na"          # cleared | credible | weak | na
    dsr: float | None = None


class ScanRow(BaseModel):
    ticker: str
    signals: dict[str, bool | None]
    real_bull: int            # any real agent long
    real_total: int
    credible_bull: int        # credible+cleared real agents long
    credible_total: int
    cleared_bull: int         # DSR-cleared real agents long
    market_on: bool | None
    stance: str               # default (credible-based)
    error: str | None = None


class ScanResult(BaseModel):
    as_of: str
    agents: list[AgentMeta]
    rows: list[ScanRow]
    n_tickers: int
    n_dsr_cleared: int        # how many real agents are DSR-cleared at all


class ScanJob(BaseModel):
    job_id: str
    tickers: list[str]
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    result: ScanResult | None = None
    error_message: str | None = None


_JOBS: dict[str, ScanJob] = {}


@router.post("/scan", response_model=ScanJob)
async def create(body: ScanCreate) -> ScanJob:
    tickers = [t.strip().upper() for t in (body.tickers or []) if t.strip()][:12]
    if not tickers:
        raise HTTPException(400, "provide 1–12 tickers, e.g. AAPL,MSFT,NVDA")
    now = datetime.now(timezone.utc)
    job = ScanJob(job_id=uuid.uuid4().hex[:12], tickers=tickers, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job.job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/scan/{job_id}", response_model=ScanJob)
async def get_job(job_id: str) -> ScanJob:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "scan job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "scanner"}


async def _wait(coro, t):
    return await asyncio.wait_for(coro, timeout=t)


async def _scan_ticker(tk: str, vix_map, tmap, tiers: dict[str, str]) -> ScanRow:
    from task3_strategy.pipeline.prices import fetch_prices
    from task19_anomaly.pipeline.signals import make_want_long as t19_wl
    from task19_anomaly.schemas import AnomalySpec
    from task20_vix.pipeline.signals import make_want_long as t20_wl
    from task20_vix.schemas import VixSpec
    from tools.divination_null_band import _control_signals, _listing

    sig: dict[str, bool | None] = {k: None for k, _, _ in AGENTS}
    err = None
    ctrl_keys = {"T25 astrology": "T25", "T27 八字": "T27", "T35 Jyotiṣa": "T35"}
    try:
        prices = await asyncio.to_thread(fetch_prices, tk)
        latest = prices[-1].date
        start = max(prices[0].date, latest - timedelta(days=365 * 5))
        dates = [p.date for p in prices if p.date >= start]
        listing = await asyncio.to_thread(_listing, tk, prices[0].date)

        try: sig["T19"] = bool(t19_wl(AnomalySpec(entry_signal="near_52w_high"), prices)(latest))
        except Exception: pass  # noqa: BLE001,E701
        if vix_map:
            try: sig["T20"] = bool(t20_wl(VixSpec(entry_signal="vix_term_gate"), vix_map)(latest))
            except Exception: pass  # noqa: BLE001,E701
        for system, sigs in _control_signals(listing, dates):
            key = ctrl_keys.get(system)
            if key and sigs:
                try: sig[key] = bool(sigs[0][1](latest))
                except Exception: pass  # noqa: BLE001,E701

        cik = tmap.get(tk)
        if cik:
            try:  # T17 quality (SEC companyfacts)
                from task17_quality.pipeline.factors import build_bundle, wants_long, fetch_companyfacts
                from task17_quality.schemas import QualitySpec
                bundle = build_bundle(await _wait(fetch_companyfacts(cik), 30))
                sig["T17"] = bool(wants_long(QualitySpec(entry_signal="composite_quality"), bundle, latest))
            except Exception: pass  # noqa: BLE001,E701
            try:  # T18 events (LLM extract — best-effort, own timeout)
                from task18_events.pipeline.events import fetch_events, make_want_long as t18_wl
                from task18_events.schemas import EventSpec
                _rec, bundle = await _wait(fetch_events(cik, since=latest - timedelta(days=180),
                                                        trace_id=f"scan-{tk}", ticker=tk, budget_usd=0.03), 40)
                sig["T18"] = bool(t18_wl(EventSpec(entry_signal="activist_drift"), bundle)(latest))
            except Exception: pass  # noqa: BLE001,E701
        try:  # T22 congress (provider — best-effort)
            from task22_congress.pipeline.congress_data import fetch_congress_trades
            from task22_congress.pipeline.signals import make_want_long as t22_wl, split_dates
            from task22_congress.schemas import CongressSpec
            trades, _prov = await _wait(fetch_congress_trades(tk, since=latest - timedelta(days=180), as_of=latest), 25)
            if trades:
                sig["T22"] = bool(t22_wl(CongressSpec(entry_signal="follow_buys"), split_dates(trades))(latest))
        except Exception: pass  # noqa: BLE001,E701
    except Exception as e:  # noqa: BLE001
        err = type(e).__name__

    real_present = [k for k in _REAL if sig.get(k) is not None]
    real_bull = sum(1 for k in real_present if sig[k])
    cred_present = [k for k in real_present if tiers.get(k) in ("cleared", "credible")]
    cred_bull = sum(1 for k in cred_present if sig[k])
    cleared_present = [k for k in real_present if tiers.get(k) == "cleared"]
    cleared_bull = sum(1 for k in cleared_present if sig[k])
    market_on = sig.get("T20")

    if err or not real_present:
        stance = "資料不足"
    elif market_on is False:
        stance = "市場 risk-off → 持有 SPY"
    elif cred_present and cred_bull >= max(1, (len(cred_present) + 1) // 2):
        stance = "傾向做多"
    else:
        stance = "持有 SPY（無訊號）"

    return ScanRow(ticker=tk, signals=sig, real_bull=real_bull, real_total=len(real_present),
                   credible_bull=cred_bull, credible_total=len(cred_present), cleared_bull=cleared_bull,
                   market_on=market_on, stance=stance, error=err)


async def _scan(tickers: list[str]) -> ScanResult:
    from task3_strategy.pipeline.prices import fetch_prices
    from task20_vix.pipeline.signals import build_vix_map
    from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map

    try:
        vix_map = build_vix_map(await asyncio.to_thread(fetch_prices, "^VIX"),
                                await asyncio.to_thread(fetch_prices, "^VIX3M"))
    except Exception:  # noqa: BLE001
        vix_map = {}
    try:
        tmap = await fetch_sec_ticker_map()
    except Exception:  # noqa: BLE001
        tmap = {}

    dm = _dsr_map()
    tiers = {k: _tier(k, dm)[0] for k, _, _ in AGENTS}
    agents = [AgentMeta(key=k, label=lbl, kind=kind, tier=_tier(k, dm)[0], dsr=_tier(k, dm)[1]) for k, lbl, kind in AGENTS]

    rows = await asyncio.gather(*[_scan_ticker(tk, vix_map, tmap, tiers) for tk in tickers])
    n_cleared = sum(1 for a in agents if a.kind == "real" and a.tier == "cleared")
    return ScanResult(as_of=date.today().isoformat(), agents=agents, rows=list(rows),
                      n_tickers=len(rows), n_dsr_cleared=n_cleared)


async def _run(job: ScanJob) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(_scan(job.tickers), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"scan timed out after {int(_JOB_TIMEOUT_S)}s — try fewer tickers."
    except Exception as e:  # noqa: BLE001
        logger.exception("scanner_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
