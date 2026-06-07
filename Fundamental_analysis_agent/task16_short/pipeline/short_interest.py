"""NASDAQ bi-monthly settlement short-INTEREST (shares short + days-to-cover), cached.

This is the *real* exchange-reported short interest (outstanding shorts at each
settlement date), which complements the daily short-VOLUME proxy in `finra.py`.
Source: NASDAQ's public quote API
(https://api.nasdaq.com/api/quote/{SYM}/short-interest), which returns ~12 months
of bi-monthly settlement dates with shares short, avg daily volume, and days-to-cover.

LOOKAHEAD SAFETY: FINRA publishes each settlement's short interest ~8 business days
later, so a settlement-date reading is NOT public on that date. We key every reading
to `settlement_date + _PUBLISH_LAG_DAYS` (a conservative ~11 calendar days), and the
backtest's `dtc_asof` only reads samples STRICTLY BEFORE the bar — so the signal can
never act on data that wasn't yet published.

Cached to disk like the short-volume series (1-day TTL).
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from shared.config import get_settings
from shared.logging import get_logger

logger = get_logger(__name__)

_URL = "https://api.nasdaq.com/api/quote/{sym}/short-interest?assetClass=stocks"
# NASDAQ's API rejects non-browser clients; mimic a browser.
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}
_PUBLISH_LAG_DAYS = 11          # FINRA publishes ~8 business days after settlement; pad to be safe
_CACHE_TTL = timedelta(days=1)


def _cache_path(ticker: str) -> Path:
    base = Path(get_settings().artifact_dir) / "short_interest"
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{ticker.upper()}.json"


def _load_cache(ticker: str) -> list[tuple[date, float, float]] | None:
    p = _cache_path(ticker)
    if not p.exists():
        return None
    try:
        blob = json.loads(p.read_text())
        if datetime.now(timezone.utc) - datetime.fromisoformat(blob["fetched_at"]) > _CACHE_TTL:
            return None
        return [(date.fromisoformat(d), float(dtc), float(si)) for d, dtc, si in blob["series"]]
    except Exception:  # noqa: BLE001
        return None


def _save_cache(ticker: str, series: list[tuple[date, float, float]]) -> None:
    _cache_path(ticker).write_text(json.dumps({
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "series": [[d.isoformat(), dtc, si] for d, dtc, si in series],
    }))


def _num(s: object) -> float | None:
    try:
        return float(str(s).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


def _parse(payload: dict) -> list[tuple[date, float, float]]:
    """Return [(publish_date, days_to_cover, short_interest_shares)], oldest first."""
    rows = (((payload or {}).get("data") or {}).get("shortInterestTable") or {}).get("rows") or []
    out: list[tuple[date, float, float]] = []
    for r in rows:
        sd_raw = r.get("settlementDate")
        dtc = _num(r.get("daysToCover"))
        si = _num(r.get("interest"))
        if not sd_raw or dtc is None or si is None:
            continue
        try:
            sd = datetime.strptime(sd_raw, "%m/%d/%Y").date()
        except ValueError:
            continue
        out.append((sd + timedelta(days=_PUBLISH_LAG_DAYS), dtc, si))   # key to publish date
    out.sort(key=lambda x: x[0])
    return out


async def fetch_short_interest_series(ticker: str) -> list[tuple[date, float, float]]:
    """Bi-monthly short-interest series, publish-date-keyed. Empty list on any failure."""
    cached = _load_cache(ticker)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            r = await client.get(_URL.format(sym=ticker.upper()), headers=_HEADERS)
        if r.status_code != 200:
            logger.warning("task16_si_http", ticker=ticker, status=r.status_code)
            return []
        series = _parse(r.json())
    except Exception as e:  # noqa: BLE001
        logger.warning("task16_si_failed", ticker=ticker, error=str(e)[:160])
        return []
    _save_cache(ticker, series)
    logger.info("task16_short_interest_fetched", ticker=ticker, n=len(series))
    return series
