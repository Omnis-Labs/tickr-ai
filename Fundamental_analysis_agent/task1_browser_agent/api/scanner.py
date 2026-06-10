"""Signal Scanner — the 'selection + collaboration' front door.

Instead of making the user try 35 agents one ticker at a time, the scanner runs a set of agents
across a watchlist and reports, for each name, which agents have a LONG signal *today*. It then
gives an ensemble verdict over the REAL agents, and — per the product model — defaults to holding
SPY when no agent has conviction. A few placebo controls are shown as a reference row so the user
can see that worthless signals also light up (the built-in lie-detector).

Fast + deterministic: only agents with a clean as-of `want_long(date)` and no LLM call — T19
anomaly + T17 quality (per-name), T20 VIX (market regime), and three placebo controls. SEC fetch
for T17 is best-effort (shows '—' if unavailable). Job pattern, same as the per-agent routers.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

logger = get_logger(__name__)
router = APIRouter(prefix="/scanner", tags=["scanner"])

# (key, label, kind) — kind drives the UI grouping/colour
AGENTS = [
    ("T19", "T19 · Price anomaly", "real"),
    ("T17", "T17 · Fundamental quality", "real"),
    ("T20", "T20 · VIX regime", "market"),
    ("T25", "T25 · Astrology", "placebo"),
    ("T27", "T27 · 八字", "placebo"),
    ("T35", "T35 · Jyotiṣa", "placebo"),
]
_REAL = [k for k, _, kind in AGENTS if kind == "real"]
_JOB_TIMEOUT_S = 180.0


class ScanCreate(BaseModel):
    tickers: list[str]


class AgentMeta(BaseModel):
    key: str
    label: str
    kind: str


class ScanRow(BaseModel):
    ticker: str
    signals: dict[str, bool | None]
    real_bull: int
    real_total: int
    market_on: bool | None
    stance: str          # "傾向做多" | "持有 SPY（無訊號）" | "市場 risk-off"
    error: str | None = None


class ScanResult(BaseModel):
    as_of: str
    agents: list[AgentMeta]
    rows: list[ScanRow]
    n_tickers: int


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


async def _scan(tickers: list[str]) -> ScanResult:
    from task3_strategy.pipeline.prices import fetch_prices
    from task19_anomaly.pipeline.signals import make_want_long as t19_wl
    from task19_anomaly.schemas import AnomalySpec
    from task20_vix.pipeline.signals import build_vix_map, make_want_long as t20_wl
    from task20_vix.schemas import VixSpec
    from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map
    from tools.divination_null_band import _control_signals, _listing

    try:
        vix_map = build_vix_map(await asyncio.to_thread(fetch_prices, "^VIX"),
                                await asyncio.to_thread(fetch_prices, "^VIX3M"))
    except Exception:  # noqa: BLE001
        vix_map = {}
    try:
        tmap = await fetch_sec_ticker_map()
    except Exception:  # noqa: BLE001
        tmap = {}

    rows: list[ScanRow] = []
    as_of = ""
    ctrl_keys = {"T25 astrology": "T25", "T27 八字": "T27", "T35 Jyotiṣa": "T35"}
    for tk in tickers:
        sig: dict[str, bool | None] = {k: None for k, _, _ in AGENTS}
        err = None
        try:
            prices = await asyncio.to_thread(fetch_prices, tk)
            latest = prices[-1].date
            as_of = max(as_of, latest.isoformat())
            start = max(prices[0].date, latest - timedelta(days=365 * 5))
            dates = [p.date for p in prices if p.date >= start]
            listing = await asyncio.to_thread(_listing, tk, prices[0].date)

            try: sig["T19"] = bool(t19_wl(AnomalySpec(entry_signal="near_52w_high"), prices)(latest))
            except Exception: pass  # noqa: BLE001,E701
            if vix_map:
                try: sig["T20"] = bool(t20_wl(VixSpec(entry_signal="vix_term_gate"), vix_map)(latest))
                except Exception: pass  # noqa: BLE001,E701
            # placebo controls (primary signal, evaluated as-of latest)
            for system, sigs in _control_signals(listing, dates):
                key = ctrl_keys.get(system)
                if key and sigs:
                    try: sig[key] = bool(sigs[0][1](latest))
                    except Exception: pass  # noqa: BLE001,E701
            # T17 quality — best-effort SEC companyfacts
            cik = tmap.get(tk)
            if cik:
                try:
                    from task17_quality.pipeline.factors import build_bundle, wants_long, fetch_companyfacts
                    from task17_quality.schemas import QualitySpec
                    bundle = build_bundle(await fetch_companyfacts(cik))
                    sig["T17"] = bool(wants_long(QualitySpec(entry_signal="composite_quality"), bundle, latest))
                except Exception: pass  # noqa: BLE001,E701
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}"

        real_vals = [sig[k] for k in _REAL if sig.get(k) is not None]
        real_bull = sum(1 for v in real_vals if v)
        market_on = sig.get("T20")
        if err or not real_vals:
            stance = "資料不足"
        elif market_on is False:
            stance = "市場 risk-off → 持有 SPY"
        elif real_bull >= max(1, (len(real_vals) + 1) // 2):
            stance = "傾向做多"
        else:
            stance = "持有 SPY（無訊號）"
        rows.append(ScanRow(ticker=tk, signals=sig, real_bull=real_bull, real_total=len(real_vals),
                            market_on=market_on, stance=stance, error=err))

    return ScanResult(as_of=as_of or date.today().isoformat(),
                      agents=[AgentMeta(key=k, label=lbl, kind=kind) for k, lbl, kind in AGENTS],
                      rows=rows, n_tickers=len(rows))


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
