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
    ("T11", "T11 · Fundamentals trend", "real"),
    ("T15", "T15 · Buyback", "real"),
    ("T6", "T6 · Insider (Form 4)", "real"),
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


# ----------------------------------------------------------------------------
# "Today's book" backtest — hold each picked name only when its credible agents
# signal long (decided as-of each historical day, lookahead-free), else SPY;
# equal-weight across the book. This is the idle=SPY product model, NOT a
# hindsight static basket (which would be look-ahead biased).
# ----------------------------------------------------------------------------
_BT_YEARS = 3
_TXN = 0.001


class BookCreate(BaseModel):
    tickers: list[str]


class CurvePoint(BaseModel):
    date: str
    book: float
    spy: float


class BookMetrics(BaseModel):
    book_return_pct: float
    spy_return_pct: float
    alpha_pp: float
    sharpe: float
    max_dd_pct: float
    avg_in_name_pct: float
    n_names: int
    n_days: int


class BookResult(BaseModel):
    names: list[str]
    metrics: BookMetrics
    curve: list[CurvePoint]


class BookJob(BaseModel):
    job_id: str
    tickers: list[str]
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    result: BookResult | None = None
    error_message: str | None = None


_BOOK_JOBS: dict[str, BookJob] = {}


@router.post("/backtest", response_model=BookJob)
async def create_backtest(body: BookCreate) -> BookJob:
    tickers = [t.strip().upper() for t in (body.tickers or []) if t.strip()][:12]
    if not tickers:
        raise HTTPException(400, "provide the book's tickers")
    now = datetime.now(timezone.utc)
    job = BookJob(job_id=uuid.uuid4().hex[:12], tickers=tickers, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _BOOK_JOBS[job.job_id] = job
    asyncio.create_task(_run_backtest(job))
    return job


@router.get("/backtest/{job_id}", response_model=BookJob)
async def get_backtest(job_id: str) -> BookJob:
    job = _BOOK_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "backtest job not found")
    return job


async def _name_path(tk: str, spy_dates: list, spy_ret: dict, tmap) -> tuple[list[float], float] | None:
    """Per-name daily returns on the SPY date axis: hold the name when its credible agents
    (T19 + T17) signal long as-of the prior close, else hold SPY. Returns (rets, in_name_frac)."""
    from task3_strategy.pipeline.prices import fetch_prices
    from task19_anomaly.pipeline.signals import make_want_long as t19_wl
    from task19_anomaly.schemas import AnomalySpec
    try:
        prices = await asyncio.to_thread(fetch_prices, tk)
    except Exception:  # noqa: BLE001
        return None
    close = {p.date: p.close for p in prices}
    wls = []
    try: wls.append(t19_wl(AnomalySpec(entry_signal="near_52w_high"), prices))
    except Exception: pass  # noqa: BLE001,E701
    cik = tmap.get(tk)
    if cik:
        try:
            from task17_quality.pipeline.factors import build_bundle, wants_long, fetch_companyfacts
            from task17_quality.schemas import QualitySpec
            bundle = build_bundle(await _wait(fetch_companyfacts(cik), 30))
            spec = QualitySpec(entry_signal="composite_quality")
            wls.append(lambda d, b=bundle, s=spec: wants_long(s, b, d))
        except Exception: pass  # noqa: BLE001,E701

    def ens_long(d) -> bool:
        votes = []
        for wl in wls:
            try: votes.append(bool(wl(d)))
            except Exception: votes.append(False)  # noqa: BLE001,E701
        return bool(votes) and sum(votes) >= max(1, (len(votes) + 1) // 2)

    rets: list[float] = []
    in_name = 0
    prev_long = None
    for i in range(1, len(spy_dates)):
        d, dp = spy_dates[i], spy_dates[i - 1]
        if d in close and dp in close and close[dp]:
            long = ens_long(dp)
            r = (close[d] / close[dp] - 1.0) if long else spy_ret[d]
            if prev_long is not None and long != prev_long:
                r -= _TXN
            rets.append(r); prev_long = long
            if long:
                in_name += 1
        else:
            rets.append(spy_ret[d]); prev_long = False     # name not tradable that day → hold SPY
    return rets, (in_name / max(1, len(rets)))


async def _book_backtest(tickers: list[str]) -> BookResult:
    import math
    from task3_strategy.pipeline.prices import fetch_prices
    from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map

    spy = await asyncio.to_thread(fetch_prices, "SPY")
    as_of = spy[-1].date
    start = as_of - timedelta(days=365 * _BT_YEARS)
    sdates = [p.date for p in spy if p.date >= start]
    sclose = {p.date: p.close for p in spy}
    spy_ret = {sdates[i]: sclose[sdates[i]] / sclose[sdates[i - 1]] - 1.0 for i in range(1, len(sdates))}
    try: tmap = await fetch_sec_ticker_map()
    except Exception: tmap = {}  # noqa: BLE001,E701

    paths = await asyncio.gather(*[_name_path(tk, sdates, spy_ret, tmap) for tk in tickers])
    good = [(tickers[i], p) for i, p in enumerate(paths) if p]
    if not good:
        raise RuntimeError("no tradable names in the book")
    n = len(sdates) - 1
    in_fracs = [p[1] for _, p in good]
    book_eq, spy_eq = 1.0, 1.0
    daily, curve = [], []
    peak, mdd = 1.0, 0.0
    for i in range(n):
        pr = sum(p[0][i] for _, p in good) / len(good)     # equal-weight book daily return
        sr = spy_ret[sdates[i + 1]]
        book_eq *= (1 + pr); spy_eq *= (1 + sr); daily.append(pr)
        peak = max(peak, book_eq); mdd = min(mdd, book_eq / peak - 1)
        if i % max(1, n // 120) == 0 or i == n - 1:
            curve.append(CurvePoint(date=sdates[i + 1].isoformat(), book=round(book_eq, 4), spy=round(spy_eq, 4)))
    import statistics as st
    sd = st.pstdev(daily) if len(daily) > 2 else 0.0
    sharpe = (st.mean(daily) / sd * math.sqrt(252)) if sd > 0 else 0.0
    return BookResult(
        names=[t for t, _ in good],
        metrics=BookMetrics(book_return_pct=round((book_eq - 1) * 100, 1), spy_return_pct=round((spy_eq - 1) * 100, 1),
                            alpha_pp=round((book_eq - spy_eq) * 100, 1), sharpe=round(sharpe, 2),
                            max_dd_pct=round(mdd * 100, 1), avg_in_name_pct=round(sum(in_fracs) / len(in_fracs) * 100, 0),
                            n_names=len(good), n_days=n),
        curve=curve)


async def _run_backtest(job: BookJob) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(_book_backtest(job.tickers), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = "backtest timed out — try fewer names."
    except Exception as e:  # noqa: BLE001
        logger.exception("scanner_backtest_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)


async def _wait(coro, t):
    return await asyncio.wait_for(coro, timeout=t)


def _last_in_market(ec) -> bool | None:
    """For agents with no clean want_long(date): infer today's position from the backtest equity
    curve — on the most recent bar the stock moved meaningfully, did the strategy capture it (long)
    or sit flat (out)? A heuristic 'read the last position' adapter."""
    for i in range(len(ec) - 1, 0, -1):
        b0, b1 = ec[i - 1].benchmark, ec[i].benchmark
        if b0 and b1:
            br = b1 / b0 - 1.0
            if abs(br) > 0.003:                       # day the stock actually moved (>0.3%)
                s0, s1 = ec[i - 1].strategy, ec[i].strategy
                sr = (s1 / s0 - 1.0) if s0 else 0.0
                return abs(sr - br) < abs(br) * 0.5   # strategy tracked the move → currently long
    return None


def _bt_signal(run, *args, start) -> bool | None:
    try:
        bt = run(*args, start=start)
        return _last_in_market(bt.equity_curve)
    except Exception:  # noqa: BLE001
        return None


async def _scan_ticker(tk: str, vix_map, tmap, tiers: dict[str, str]) -> ScanRow:
    from task3_strategy.pipeline.prices import fetch_prices
    from task19_anomaly.pipeline.signals import make_want_long as t19_wl
    from task19_anomaly.schemas import AnomalySpec
    from task20_vix.pipeline.signals import make_want_long as t20_wl
    from task20_vix.schemas import VixSpec

    sig: dict[str, bool | None] = {k: None for k, _, _ in AGENTS}
    err = None
    try:
        prices = await asyncio.to_thread(fetch_prices, tk)
        latest = prices[-1].date
        start = max(prices[0].date, latest - timedelta(days=365 * 5))
        dates = [p.date for p in prices if p.date >= start]
        listing = prices[0].date          # first-available bar as the 'natal' date for the controls

        try: sig["T19"] = bool(t19_wl(AnomalySpec(entry_signal="near_52w_high"), prices)(latest))
        except Exception: pass  # noqa: BLE001,E701
        if vix_map:
            try: sig["T20"] = bool(t20_wl(VixSpec(entry_signal="vix_term_gate"), vix_map)(latest))
            except Exception: pass  # noqa: BLE001,E701
        # placebo controls — built directly from their own (deployed) packages, no tools/ dependency
        try:
            from task25_astro.pipeline import astro as _A
            from task25_astro.schemas import AstroSpec
            sig["T25"] = bool(_A.make_want_long(AstroSpec(entry_signal="avoid_mercury_retrograde"), _A.build_astro_state(dates, 6.0))(latest))
        except Exception: pass  # noqa: BLE001,E701
        try:
            from task27_bazi.pipeline import bazi as _B
            from task27_bazi.schemas import BaziSpec
            fav = set(_B.strength_and_favourable(_B.four_pillars(listing))["favourable"])
            sig["T27"] = bool(_B.make_want_long(BaziSpec(entry_signal="favorable_year"), fav)(latest))
        except Exception: pass  # noqa: BLE001,E701
        try:
            from task35_jyotish.pipeline import jyotish as _JY
            from task35_jyotish.schemas import JyotishSpec
            sig["T35"] = bool(_JY.make_want_long(JyotishSpec(entry_signal="benefic_dasha"), listing)(latest))
        except Exception: pass  # noqa: BLE001,E701

        cik = tmap.get(tk)
        bt_start = max(prices[0].date, latest - timedelta(days=365 * 3))
        if cik:
            cf = None
            try:
                from task17_quality.pipeline.factors import fetch_companyfacts
                cf = await _wait(fetch_companyfacts(cik), 30)   # one companyfacts fetch, shared by T17/T15/T11
            except Exception: cf = None  # noqa: BLE001,E701
            if cf:
                try:  # T17 quality — composite quality factor (clean want_long)
                    from task17_quality.pipeline.factors import build_bundle, wants_long
                    from task17_quality.schemas import QualitySpec
                    sig["T17"] = bool(wants_long(QualitySpec(entry_signal="composite_quality"), build_bundle(cf), latest))
                except Exception: pass  # noqa: BLE001,E701
                try:  # T15 buyback — no clean want_long → read last backtest position
                    from task15_buyback.pipeline.signals import extract_shares
                    from task15_buyback.pipeline.backtest import run_buyback_backtest
                    from task15_buyback.schemas import BuybackSpec
                    sig["T15"] = _bt_signal(run_buyback_backtest, prices, extract_shares(cf), BuybackSpec(entry_signal="buyback"), start=bt_start)
                except Exception: pass  # noqa: BLE001,E701
                try:  # T11 fundamentals trend — read last backtest position
                    from task11_fundamentals_trend.pipeline.companyfacts import extract_quarters
                    from task11_fundamentals_trend.pipeline.backtest import run_fundtrend_backtest
                    from task11_fundamentals_trend.schemas import FundTrendSpec
                    sig["T11"] = _bt_signal(run_fundtrend_backtest, prices, extract_quarters(cf), FundTrendSpec(entry_signal="growth_and_margin"), start=bt_start)
                except Exception: pass  # noqa: BLE001,E701
            try:  # T6 insider — Form 4, read last backtest position
                from task6_insider.pipeline.forms import fetch_form4_txns
                from task6_insider.pipeline.backtest import run_insider_backtest
                from task6_insider.schemas import InsiderSpec
                txns, _nf, _cap = await _wait(fetch_form4_txns(cik, since=bt_start - timedelta(days=365), max_filings=60), 30)
                sig["T6"] = _bt_signal(run_insider_backtest, prices, txns, InsiderSpec(entry_signal="cluster_buy"), start=bt_start)
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
