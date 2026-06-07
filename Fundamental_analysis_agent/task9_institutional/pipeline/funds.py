"""Fetch curated superinvestors' 13F-HR holdings of a target company.

Each fund's 13F-HR accession contains a cover (`primary_doc.xml`) and an
information-table XML (a numeric-named .xml). We parse `<infoTable>` rows, match
the target by issuer NAME (13F has no ticker), and sum shares across the
fund's sub-account rows. Reuses the Task 2 EDGAR client (UA + retry); bounded +
logged. A fund CIK that errors or files no 13F-HR is skipped, not fatal.
"""

from __future__ import annotations

import asyncio
import re
import xml.etree.ElementTree as ET
from datetime import date

import httpx

from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import _SEC_HEADERS, fetch_submissions

from task9_institutional.schemas import FundHolding

logger = get_logger(__name__)

# Curated, CIK-verified well-known 13F filers (name, CIK).
TRACKED_FUNDS: list[tuple[str, int]] = [
    ("Berkshire Hathaway", 1067983),
    ("Gates Foundation Trust", 1166559),
    ("Bridgewater Associates", 1350694),
    ("Renaissance Technologies", 1037389),
    ("Citadel Advisors", 1423053),
    ("Baupost Group", 1061768),
    ("Pershing Square", 1336528),
    ("Appaloosa", 1656456),
    ("Third Point", 1040273),
    ("Duquesne Family Office", 1536411),
    ("Greenlight Capital", 1079114),
    ("Tiger Global", 1167483),
    ("Scion Asset Management", 1649339),
]

_MAX_RETRIES = 4
_CONCURRENCY = 6
_STOP = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LLC", "PLC", "THE",
         "HOLDINGS", "GROUP", "CLASS", "COM", "INCORPORATED", "SA", "NV", "AG"}


def issuer_core(company_name: str) -> str:
    """First distinctive token of a company name, for fuzzy 13F issuer matching."""
    toks = [t for t in re.split(r"[^A-Za-z]+", company_name.upper()) if t and t not in _STOP]
    return toks[0] if toks else company_name.upper()


def _matches(issuer: str, core: str) -> bool:
    return issuer.upper().strip().startswith(core)


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


def _parse_infotable(xml_text: str, core: str) -> tuple[float, float]:
    """Sum (shares, value_usd) across rows matching the issuer core. 13F value is
    in $1000s → ×1000."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return 0.0, 0.0
    ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
    shares = value = 0.0
    for row in root.findall(f".//{ns}infoTable"):
        name = (row.findtext(f"{ns}nameOfIssuer") or "").strip()
        if not _matches(name, core):
            continue
        amt = row.find(f"{ns}shrsOrPrnAmt")
        try:
            shares += float((amt.findtext(f"{ns}sshPrnamt") if amt is not None else "0") or 0)
            value += float(row.findtext(f"{ns}value") or 0) * 1000.0
        except ValueError:
            continue
    return shares, value


async def fetch_fund_holdings(
    company_name: str, *, since: date, max_filings_per_fund: int = 8,
) -> tuple[list[FundHolding], int]:
    """Return (holdings across tracked funds for the company, n_funds_tracked)."""
    core = issuer_core(company_name)
    sem = asyncio.Semaphore(_CONCURRENCY)
    out: list[FundHolding] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        async def _one_fund(fund_name: str, cik: int) -> list[FundHolding]:
            try:
                recent = (await fetch_submissions(cik)).get("filings", {}).get("recent", {})
            except Exception:  # noqa: BLE001
                return []
            forms = recent.get("form", [])
            accs = recent.get("accessionNumber", [])
            fdates = recent.get("filingDate", [])
            picks = []
            for i, f in enumerate(forms):
                if f != "13F-HR":
                    continue
                try:
                    fd = date.fromisoformat(fdates[i])
                except (ValueError, IndexError):
                    continue
                if fd >= since:
                    picks.append((fd, accs[i]))
            picks.sort(key=lambda p: p[0], reverse=True)
            picks = picks[:max_filings_per_fund]

            holdings: list[FundHolding] = []
            for fd, accession in picks:
                async with sem:
                    acc = accession.replace("-", "")
                    idx = await _get(client, f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json", as_json=True)
                    if not idx:
                        continue
                    xmls = [f["name"] for f in idx.get("directory", {}).get("item", [])
                            if f["name"].lower().endswith(".xml")
                            and "primary_doc" not in f["name"].lower() and "/" not in f["name"]]
                    if not xmls:
                        continue
                    xml = await _get(client, f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{xmls[0]}", as_json=False)
                    if not xml:
                        continue
                    shares, value = _parse_infotable(xml, core)
                    if shares > 0:
                        holdings.append(FundHolding(filing_date=fd, fund_name=fund_name,
                                                    shares=shares, value_usd=value))
            return holdings

        results = await asyncio.gather(*(_one_fund(n, c) for n, c in TRACKED_FUNDS))

    for r in results:
        out.extend(r)
    out.sort(key=lambda h: h.filing_date)
    logger.info("task9_holdings_fetched", core=core, n=len(out),
                funds=len({h.fund_name for h in out}))
    return out, len(TRACKED_FUNDS)
