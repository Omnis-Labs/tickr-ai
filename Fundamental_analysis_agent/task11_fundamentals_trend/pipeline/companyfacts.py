"""Fetch + extract quarterly fundamentals from the SEC XBRL companyfacts API.

`https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` returns every reported
us-gaap fact with its period (start/end) and `filed` date. We extract per-quarter
(~90-day) flow metrics (revenue, gross profit, net income), de-duplicating by
period end to the AS-ORIGINALLY-FILED value (earliest `filed`) so the timeline is
point-in-time. Reuses the Task 2 EDGAR client headers/retry.
"""

from __future__ import annotations

import asyncio
from datetime import date

import httpx

from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import _SEC_HEADERS

from task11_fundamentals_trend.schemas import QuarterPoint

logger = get_logger(__name__)

_MAX_RETRIES = 4
# Revenue has changed tags over time; try them in order of recency.
_REVENUE_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
]
_GROSS_TAGS = ["GrossProfit"]
_NI_TAGS = ["NetIncomeLoss"]


async def fetch_companyfacts(cik: int) -> dict:
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
    async with httpx.AsyncClient(timeout=30.0) as client:
        for attempt in range(_MAX_RETRIES):
            resp = await client.get(url, headers=_SEC_HEADERS)
            if resp.status_code in (429, 503) and attempt < _MAX_RETRIES - 1:
                ra = resp.headers.get("Retry-After", "")
                await asyncio.sleep(float(ra) if ra.isdigit() else 0.5 * (2 ** attempt))
                continue
            resp.raise_for_status()
            return resp.json().get("facts", {}).get("us-gaap", {})
    raise RuntimeError(f"could not fetch companyfacts for CIK {cik}")


def annual_series(gaap: dict, tags: list[str], unit: str = "USD") -> dict[date, tuple[date, float]]:
    """{period_end: (filed, val)} for ANNUAL (~365-day) flow periods, earliest-filed
    per end (point-in-time). Used by fiscal-year factor agents (F-Score, accruals)."""
    for tag in tags:
        if tag not in gaap:
            continue
        units = gaap[tag].get("units", {})
        rows = units.get(unit) or (next(iter(units.values())) if len(units) == 1 else [])
        out: dict[date, tuple[date, float]] = {}
        for r in rows:
            start, end, filed, val = r.get("start"), r.get("end"), r.get("filed"), r.get("val")
            if not (start and end and filed and val is not None) or r.get("form") not in ("10-K", "10-Q"):
                continue
            try:
                sd, ed, fd = date.fromisoformat(start), date.fromisoformat(end), date.fromisoformat(filed)
            except ValueError:
                continue
            if not (350 <= (ed - sd).days <= 380):
                continue
            if ed not in out or fd < out[ed][0]:
                out[ed] = (fd, float(val))
        if out:
            return out
    return {}


def instant_series(gaap: dict, tags: list[str], unit: str = "USD") -> dict[date, tuple[date, float]]:
    """{as-of date: (filed, val)} for INSTANT (balance-sheet) facts, earliest-filed
    per date (point-in-time)."""
    for tag in tags:
        if tag not in gaap:
            continue
        units = gaap[tag].get("units", {})
        rows = units.get(unit) or (next(iter(units.values())) if len(units) == 1 else [])
        out: dict[date, tuple[date, float]] = {}
        for r in rows:
            end, filed, val = r.get("end"), r.get("filed"), r.get("val")
            if not (end and filed and val is not None) or r.get("start"):   # instant = no start
                continue
            if r.get("form") not in ("10-K", "10-Q"):
                continue
            try:
                ed, fd = date.fromisoformat(end), date.fromisoformat(filed)
            except ValueError:
                continue
            if ed not in out or fd < out[ed][0]:
                out[ed] = (fd, float(val))
        if out:
            return out
    return {}


def _quarterly_series(
    gaap: dict, tags: list[str], unit: str = "USD",
) -> dict[date, tuple[date, int, str, float]]:
    """For the first present tag, return {period_end: (filed, fy, fp, val)} keeping
    only ~quarterly (80–100 day) periods, earliest-filed per end (point-in-time).

    `unit` selects the XBRL unit (USD for $ flows; 'shares' for share counts);
    falls back to the sole available unit if the requested one is absent."""
    for tag in tags:
        if tag not in gaap:
            continue
        units = gaap[tag].get("units", {})
        rows = units.get(unit)
        if rows is None:
            rows = next(iter(units.values())) if len(units) == 1 else []
        out: dict[date, tuple[date, int, str, float]] = {}
        for r in rows:
            start, end, filed = r.get("start"), r.get("end"), r.get("filed")
            fp, fy, val, form = r.get("fp"), r.get("fy"), r.get("val"), r.get("form", "")
            if not (start and end and filed and val is not None):
                continue
            try:
                sd, ed, fd = date.fromisoformat(start), date.fromisoformat(end), date.fromisoformat(filed)
            except ValueError:
                continue
            if not (80 <= (ed - sd).days <= 100):     # quarterly periods only
                continue
            if form not in ("10-Q", "10-K"):
                continue
            prev = out.get(ed)
            if prev is None or fd < prev[0]:           # keep earliest-filed (as originally reported)
                out[ed] = (fd, int(fy or 0), str(fp or ""), float(val))
        if out:
            return out
    return {}


def extract_quarters(gaap: dict) -> list[QuarterPoint]:
    """Merge revenue / gross profit / net income quarterly series into per-quarter
    records keyed by period end, sorted ascending."""
    rev = _quarterly_series(gaap, _REVENUE_TAGS)
    gp = _quarterly_series(gaap, _GROSS_TAGS)
    ni = _quarterly_series(gaap, _NI_TAGS)
    ends = sorted(set(rev) | set(gp) | set(ni))
    out: list[QuarterPoint] = []
    for ed in ends:
        # filed/fy/fp from whichever metric reported this period (prefer revenue)
        meta = rev.get(ed) or ni.get(ed) or gp.get(ed)
        if meta is None:
            continue
        filed, fy, fp, _ = meta
        out.append(QuarterPoint(
            end=ed, filed=filed, fy=fy, fp=fp,
            revenue=rev.get(ed, (None, 0, "", None))[3] if ed in rev else None,
            gross_profit=gp.get(ed, (None, 0, "", None))[3] if ed in gp else None,
            net_income=ni.get(ed, (None, 0, "", None))[3] if ed in ni else None,
        ))
    logger.info("task11_quarters_extracted", n=len(out))
    return out
