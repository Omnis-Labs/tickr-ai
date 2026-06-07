"""FINRA daily short-volume (CNMS regsho) → weekly-sampled per-ticker series, cached.

Each daily file (https://cdn.finra.org/equity/regsho/daily/CNMSshvol{YYYYMMDD}.txt)
is pipe-delimited, all NMS symbols: Date|Symbol|ShortVolume|ShortExemptVolume|
TotalVolume|Market. We sample ~weekly over the window (a non-trading day 404s →
step back a few days), extract the ticker's short-volume ratio, and CACHE the
extracted per-ticker series to disk so re-runs are instant (the first run fetches
~130 ~500 KB files).
"""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from shared.config import get_settings
from shared.logging import get_logger

logger = get_logger(__name__)

_BASE = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol"
_UA = {"User-Agent": "Fundamental Analysis Agent research contact@example.com"}
_CONCURRENCY = 8
_CACHE_TTL = timedelta(days=1)


def _cache_path(ticker: str) -> Path:
    base = Path(get_settings().artifact_dir) / "short"
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{ticker.upper()}.json"


def _load_cache(ticker: str) -> list[tuple[date, float]] | None:
    p = _cache_path(ticker)
    if not p.exists():
        return None
    try:
        blob = json.loads(p.read_text())
        if datetime.now(timezone.utc) - datetime.fromisoformat(blob["fetched_at"]) > _CACHE_TTL:
            return None
        return [(date.fromisoformat(d), v) for d, v in blob["series"]]
    except Exception:  # noqa: BLE001
        return None


def _save_cache(ticker: str, series: list[tuple[date, float]]) -> None:
    _cache_path(ticker).write_text(json.dumps({
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "series": [[d.isoformat(), v] for d, v in series],
    }))


def _parse(text: str, ticker: str) -> float | None:
    """Short-volume ratio (%) for the ticker, or None if absent/zero volume."""
    for line in text.splitlines():
        parts = line.split("|")
        if len(parts) >= 5 and parts[1] == ticker:
            try:
                sv, tv = float(parts[2]), float(parts[4])
                return (sv / tv * 100.0) if tv > 0 else None
            except ValueError:
                return None
    return None


async def fetch_short_volume_series(
    ticker: str, *, since: date, as_of: date, weekly_step_days: int = 7, max_samples: int = 140,
) -> list[tuple[date, float]]:
    cached = _load_cache(ticker)
    if cached is not None:
        return cached

    # weekly target dates across the window
    targets: list[date] = []
    d = since
    while d <= as_of and len(targets) < max_samples:
        targets.append(d)
        d += timedelta(days=weekly_step_days)
    sem = asyncio.Semaphore(_CONCURRENCY)
    out: list[tuple[date, float]] = []

    async with httpx.AsyncClient(timeout=25.0) as client:
        async def _one(t: date) -> tuple[date, float] | None:
            async with sem:
                for back in range(0, 5):       # step back to the prior trading day on a 404
                    fd = t - timedelta(days=back)
                    try:
                        r = await client.get(f"{_BASE}{fd.strftime('%Y%m%d')}.txt", headers=_UA)
                    except httpx.HTTPError:
                        return None
                    if r.status_code == 200:
                        svr = _parse(r.text, ticker)
                        return (fd, svr) if svr is not None else None
                return None

        results = await asyncio.gather(*(_one(t) for t in targets))

    seen = set()
    for r in results:
        if r and r[0] not in seen:
            seen.add(r[0]); out.append(r)
    out.sort(key=lambda x: x[0])
    _save_cache(ticker, out)
    logger.info("task16_short_volume_fetched", ticker=ticker, n=len(out))
    return out
