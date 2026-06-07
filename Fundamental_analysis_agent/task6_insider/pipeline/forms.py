"""SEC Form 4 fetch + parse → list[InsiderTxn].

Reuses the Task 2 EDGAR client (SEC-compliant UA + 429/503 retry/backoff, ticker
→ CIK map with disk cache). Adds a text GET for the raw ownership XML.

Bounding: a large-cap files hundreds of Form 4s a year (AAPL had ~590 in the
recent-1000 block alone). We therefore (a) only keep filings within the backtest
window and (b) hard-cap the number of ownership XMLs fetched to `max_filings`
(most recent first). Whenever we drop filings we set `capped=True` and log it —
never a silent truncation.
"""

from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import PurePosixPath

import httpx

from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import _SEC_HEADERS, fetch_submissions

from task6_insider.schemas import InsiderTxn

logger = get_logger(__name__)

_MAX_RETRIES = 4
_FETCH_CONCURRENCY = 5     # gentle on SEC's ~10 req/s budget


async def _sec_get_text(client: httpx.AsyncClient, url: str) -> str | None:
    """GET a SEC document as text, retrying 429/503 with backoff. Returns None
    on a non-retryable error so one bad filing can't sink the whole run."""
    for attempt in range(_MAX_RETRIES):
        try:
            resp = await client.get(url, headers={**_SEC_HEADERS, "Accept": "application/xml"})
        except httpx.HTTPError:
            return None
        if resp.status_code in (429, 503) and attempt < _MAX_RETRIES - 1:
            ra = resp.headers.get("Retry-After", "")
            await asyncio.sleep(float(ra) if ra.isdigit() else 0.5 * (2 ** attempt))
            continue
        if resp.status_code != 200:
            return None
        return resp.text
    return None


def _raw_xml_url(cik: int, accession: str, primary_document: str) -> str:
    """The `primaryDocument` points to the XSLT-rendered HTML (xslF345X0n/...);
    the raw ownership XML sits at the accession root under the same basename."""
    acc = accession.replace("-", "")
    raw = PurePosixPath(primary_document).name  # strip any xsl* directory prefix
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{raw}"


def _txt(node: ET.Element | None, path: str, default: str = "") -> str:
    if node is None:
        return default
    el = node.find(path)
    return (el.text or default).strip() if el is not None and el.text else default


def parse_form4_xml(xml_text: str, filing_date: date) -> list[InsiderTxn]:
    """Parse non-derivative transactions from one Form 4 ownership XML.

    Robust to missing footnoted values (skips a line only if it has no usable
    share count). Role flags come from the first reportingOwnerRelationship.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    rel = root.find(".//reportingOwner/reportingOwnerRelationship")
    is_officer = _txt(rel, "isOfficer") in ("1", "true")
    is_director = _txt(rel, "isDirector") in ("1", "true")
    is_ten = _txt(rel, "isTenPercentOwner") in ("1", "true")
    officer_title = _txt(rel, "officerTitle")
    owner_name = _txt(root, ".//reportingOwner/reportingOwnerId/rptOwnerName")

    out: list[InsiderTxn] = []
    for tx in root.findall(".//nonDerivativeTransaction"):
        t_date = _txt(tx, "transactionDate/value")
        code = _txt(tx, "transactionCoding/transactionCode")
        shares_s = _txt(tx, "transactionAmounts/transactionShares/value")
        price_s = _txt(tx, "transactionAmounts/transactionPricePerShare/value", "0")
        ad = _txt(tx, "transactionAmounts/transactionAcquiredDisposedCode/value")
        if not shares_s or not code:
            continue
        try:
            shares = float(shares_s)
            price = float(price_s) if price_s else 0.0
            tdate = date.fromisoformat(t_date) if t_date else filing_date
        except ValueError:
            continue
        out.append(InsiderTxn(
            filing_date=filing_date, transaction_date=tdate, code=code,
            shares=shares, price=price, acquired_disposed=ad,
            is_officer=is_officer, is_director=is_director, is_ten_pct_owner=is_ten,
            owner_name=owner_name, officer_title=officer_title,
        ))
    return out


async def fetch_form4_txns(
    cik: int, *, since: date, max_filings: int = 150,
) -> tuple[list[InsiderTxn], int, bool]:
    """Fetch + parse a ticker's recent Form 4 transactions.

    Returns (transactions sorted by filing_date, n_filings_fetched, capped).
    `capped` is True if we dropped in-window filings to honour `max_filings`, or
    if older in-window filings exist beyond the submissions "recent" block.
    """
    subs = await fetch_submissions(cik)
    recent = subs.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    acc = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])
    fdates = recent.get("filingDate", [])

    # collect in-window Form 4 filings, newest first
    picks: list[tuple[date, str, str]] = []
    older_exist = False
    for i, f in enumerate(forms):
        if f != "4":
            continue
        try:
            fd = date.fromisoformat(fdates[i])
        except (ValueError, IndexError):
            continue
        if fd >= since:
            picks.append((fd, acc[i], docs[i]))
        else:
            older_exist = True
    picks.sort(key=lambda p: p[0], reverse=True)

    capped = older_exist
    if len(picks) > max_filings:
        picks = picks[:max_filings]
        capped = True
        logger.info("task6_form4_capped", cik=cik, kept=max_filings)

    sem = asyncio.Semaphore(_FETCH_CONCURRENCY)
    txns: list[InsiderTxn] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        async def _one(fd: date, accession: str, doc: str) -> list[InsiderTxn]:
            async with sem:
                xml = await _sec_get_text(client, _raw_xml_url(cik, accession, doc))
                return parse_form4_xml(xml, fd) if xml else []

        results = await asyncio.gather(*(_one(fd, a, d) for fd, a, d in picks))

    for r in results:
        txns.extend(r)
    txns.sort(key=lambda t: t.filing_date)
    logger.info("task6_form4_fetched", cik=cik, n_filings=len(picks),
                n_txns=len(txns), capped=capped)
    return txns, len(picks), capped
