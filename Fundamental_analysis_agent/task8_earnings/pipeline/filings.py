"""Fetch earnings press releases from SEC 8-K filings (Item 2.02 → Exhibit 99.1).

Reuses the Task 2 EDGAR client (UA + retry). For each earnings 8-K we read the
accession's `index.json`, pick the Ex-99.1 document (by an `ex99` name pattern,
falling back to the largest non-cover HTML), fetch it, and strip to text. Bounded
+ logged like the Form 4 fetcher — never a silent truncation.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from datetime import date

import httpx
from bs4 import BeautifulSoup

from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import _SEC_HEADERS, fetch_submissions

logger = get_logger(__name__)

_MAX_RETRIES = 4
_CONCURRENCY = 4
_EXCERPT_CHARS = 3500   # lead of the release: headline results + guidance live here


@dataclass
class EarningsRelease:
    filing_date: date
    accession: str
    excerpt: str


async def _get(client: httpx.AsyncClient, url: str, *, as_json: bool):
    for attempt in range(_MAX_RETRIES):
        try:
            resp = await client.get(url, headers=_SEC_HEADERS)
        except httpx.HTTPError:
            return None
        if resp.status_code in (429, 503) and attempt < _MAX_RETRIES - 1:
            ra = resp.headers.get("Retry-After", "")
            await asyncio.sleep(float(ra) if ra.isdigit() else 0.5 * (2 ** attempt))
            continue
        if resp.status_code != 200:
            return None
        return resp.json() if as_json else resp.text
    return None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _html_to_text(html: str) -> str:
    return re.sub(r"\s+", " ", BeautifulSoup(html, "html.parser").get_text(" ")).strip()


def _pick_exhibit(files: list[dict], primary: str) -> str | None:
    htms = [
        f for f in files
        if f["name"].lower().endswith((".htm", ".html"))
        and f["name"] != primary
        and not f["name"].startswith("R")
        and "index" not in f["name"].lower()
    ]
    if not htms:
        return None
    by_name = next((f for f in htms if "ex99" in _norm(f["name"])), None)
    chosen = by_name or max(htms, key=lambda f: int(f.get("size", 0) or 0))
    return chosen["name"]


async def fetch_earnings_releases(
    cik: int, *, since: date, max_filings: int = 12,
) -> tuple[list[EarningsRelease], bool]:
    """Return (releases sorted by filing_date asc, capped). An earnings 8-K is one
    whose `items` includes 2.02 (Results of Operations)."""
    recent = (await fetch_submissions(cik)).get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    items = recent.get("items", [""] * len(forms))
    accs = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])
    fdates = recent.get("filingDate", [])

    picks: list[tuple[date, str, str]] = []
    older_exist = False
    for i, f in enumerate(forms):
        if f != "8-K" or "2.02" not in (items[i] or ""):
            continue
        try:
            fd = date.fromisoformat(fdates[i])
        except (ValueError, IndexError):
            continue
        if fd >= since:
            picks.append((fd, accs[i], docs[i]))
        else:
            older_exist = True
    picks.sort(key=lambda p: p[0], reverse=True)
    capped = older_exist
    if len(picks) > max_filings:
        picks, capped = picks[:max_filings], True

    sem = asyncio.Semaphore(_CONCURRENCY)
    out: list[EarningsRelease] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        async def _one(fd: date, accession: str, primary: str) -> EarningsRelease | None:
            async with sem:
                acc = accession.replace("-", "")
                idx = await _get(client, f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json", as_json=True)
                if not idx:
                    return None
                name = _pick_exhibit(idx.get("directory", {}).get("item", []), primary)
                if not name:
                    return None
                html = await _get(client, f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{name}", as_json=False)
                if not html:
                    return None
                text = _html_to_text(html)
                if len(text) < 200:        # not a real press release (e.g. a cover stub)
                    return None
                return EarningsRelease(filing_date=fd, accession=accession, excerpt=text[:_EXCERPT_CHARS])

        results = await asyncio.gather(*(_one(fd, a, d) for fd, a, d in picks))

    out = [r for r in results if r is not None]
    out.sort(key=lambda r: r.filing_date)
    logger.info("task8_releases_fetched", cik=cik, n=len(out), capped=capped)
    return out, capped
