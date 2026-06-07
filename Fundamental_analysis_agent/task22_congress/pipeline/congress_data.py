"""Pluggable congressional-trades provider — paid key when present, else free best-effort.

Provider precedence (first that yields data wins):
  1. Quiver Quantitative  — if QUIVER_API_TOKEN is set (clean, full House+Senate history).
  2. FinancialModelingPrep — if FMP_API_KEY is set (senate + house endpoints).
  3. Free House-Clerk PTR parse — bounded, best-effort. The official source is PDF-only with
     NO ticker index, so we fetch the FD index, take the most-recent N PTR filings, parse those
     PDFs, and keep rows mentioning the ticker. Coverage is therefore PARTIAL and recent, House-only,
     and only the text-extractable (e-filed) PTRs parse. Honest, not complete — and it lights up to
     full coverage the moment a key is added.

Everything is keyed to the DISCLOSURE date (lookahead-safe). Results cache to disk (1-day TTL).
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from shared.config import get_settings
from shared.logging import get_logger
from task22_congress.schemas import CongressTrade

logger = get_logger(__name__)

_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
_CACHE_TTL = timedelta(days=1)
_MAX_FREE_PDFS = 60          # bound the free PDF scan (latency); recent PTRs only
_FREE_CONCURRENCY = 8


# ----------------------------------------------------------------------------- cache
def _cache_path(ticker: str) -> Path:
    base = Path(get_settings().artifact_dir) / "congress"
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{ticker.upper()}.json"


def _load_cache(ticker: str) -> tuple[list[CongressTrade], str] | None:
    p = _cache_path(ticker)
    if not p.exists():
        return None
    try:
        blob = json.loads(p.read_text())
        if datetime.now(timezone.utc) - datetime.fromisoformat(blob["fetched_at"]) > _CACHE_TTL:
            return None
        return [CongressTrade(**t) for t in blob["trades"]], blob["provider"]
    except Exception:  # noqa: BLE001
        return None


def _save_cache(ticker: str, trades: list[CongressTrade], provider: str) -> None:
    _cache_path(ticker).write_text(json.dumps({
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "trades": [json.loads(t.model_dump_json()) for t in trades],
    }))


# ----------------------------------------------------------------------------- helpers
def _amount_bracket(text: str) -> tuple[float, float]:
    nums = [float(x.replace(",", "")) for x in re.findall(r"\$\s*([\d,]+)", text or "")]
    if not nums:
        return 0.0, 0.0
    return (min(nums), max(nums)) if len(nums) >= 2 else (nums[0], nums[0])


def _txn_type(raw: str) -> str:
    r = (raw or "").lower()
    if r.startswith("s") or "sale" in r:
        return "sell"
    if r.startswith("e") or "exchange" in r:
        return "exchange"
    return "buy"


def _parse_date(s: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except (ValueError, AttributeError):
            continue
    return None


# ----------------------------------------------------------------------------- paid providers
async def _from_quiver(ticker: str) -> list[CongressTrade]:
    token = os.environ.get("QUIVER_API_TOKEN")
    if not token:
        return []
    url = f"https://api.quiverquant.com/beta/historical/congresstrading/{ticker.upper()}"
    async with httpx.AsyncClient(timeout=25.0) as c:
        r = await c.get(url, headers={"Authorization": f"Token {token}", **_UA})
    if r.status_code != 200:
        logger.warning("task22_quiver_http", status=r.status_code)
        return []
    out: list[CongressTrade] = []
    for row in r.json():
        disc = _parse_date(row.get("ReportDate") or row.get("Disclosure") or "")
        if not disc:
            continue
        lo, hi = _amount_bracket(str(row.get("Range") or row.get("Amount") or ""))
        out.append(CongressTrade(
            disclosure_date=disc, transaction_date=_parse_date(row.get("TransactionDate") or ""),
            member=str(row.get("Representative") or row.get("Senator") or ""),
            chamber="senate" if row.get("Senator") else "house",
            txn_type=_txn_type(row.get("Transaction") or "buy"),
            amount_low=lo, amount_high=hi,
        ))
    return out


async def _from_fmp(ticker: str) -> list[CongressTrade]:
    key = os.environ.get("FMP_API_KEY")
    if not key:
        return []
    out: list[CongressTrade] = []
    async with httpx.AsyncClient(timeout=25.0) as c:
        for chamber, ep in (("senate", "senate-trading"), ("house", "house-disclosure")):
            try:
                r = await c.get(f"https://financialmodelingprep.com/api/v4/{ep}",
                                params={"symbol": ticker.upper(), "apikey": key}, headers=_UA)
                if r.status_code != 200:
                    continue
                for row in r.json():
                    disc = _parse_date(row.get("disclosureDate") or row.get("dateRecieved") or "")
                    if not disc:
                        continue
                    lo, hi = _amount_bracket(str(row.get("amount") or ""))
                    out.append(CongressTrade(
                        disclosure_date=disc, transaction_date=_parse_date(row.get("transactionDate") or ""),
                        member=str(row.get("representative") or row.get("office") or ""),
                        chamber=chamber, txn_type=_txn_type(row.get("type") or "buy"),
                        amount_low=lo, amount_high=hi))
            except Exception as e:  # noqa: BLE001
                logger.warning("task22_fmp_failed", chamber=chamber, error=str(e)[:120])
    return out


# ----------------------------------------------------------------------------- free House PTR
_PTR_ROW = re.compile(
    r"\(([A-Z]{1,5})\)"                      # ticker in parens
    r".{0,80}?\b([PSE])\b"                   # transaction code P/S/E
    r".{0,40}?(\d{1,2}/\d{1,2}/\d{4})"       # transaction date
    r".{0,40}?(\$[\d,]+(?:\s*-\s*\$[\d,]+)?)",  # amount bracket
    re.DOTALL)


def _ptr_index_urls(year: int) -> str:
    return f"https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip"


async def _free_house_ptr(ticker: str, *, since: date, as_of: date) -> list[CongressTrade]:
    """Best-effort: parse the most-recent N House PTR PDFs and keep rows mentioning `ticker`."""
    try:
        from pypdf import PdfReader
    except Exception:  # noqa: BLE001
        logger.warning("task22_no_pypdf")
        return []

    years = sorted({since.year, as_of.year})
    filings: list[tuple[date, str]] = []   # (disclosure_date, DocID)
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as c:
        for y in years:
            try:
                r = await c.get(_ptr_index_urls(y), headers=_UA)
                if r.status_code != 200:
                    continue
                with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                    name = next((n for n in z.namelist() if n.endswith(".txt")), None)
                    if not name:
                        continue
                    text = z.read(name).decode("utf-8", "ignore")
            except Exception as e:  # noqa: BLE001
                logger.warning("task22_index_failed", year=y, error=str(e)[:120])
                continue
            for line in text.splitlines()[1:]:
                cols = line.split("\t")
                if len(cols) < 9 or cols[4] != "P":     # P = Periodic Transaction Report
                    continue
                fd = _parse_date(cols[7])
                doc = cols[8].strip()
                if fd and since <= fd <= as_of and doc.startswith("2"):   # 2… = e-filed (text PDF)
                    filings.append((fd, doc))

        filings.sort(reverse=True)
        filings = filings[:_MAX_FREE_PDFS]
        sem = asyncio.Semaphore(_FREE_CONCURRENCY)
        tkr = ticker.upper()

        async def _one(fd: date, doc: str) -> list[CongressTrade]:
            async with sem:
                try:
                    r = await c.get(f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/"
                                    f"{fd.year}/{doc}.pdf", headers=_UA)
                    if r.status_code != 200 or not r.content:
                        return []
                    reader = PdfReader(io.BytesIO(r.content))
                    txt = "\n".join((p.extract_text() or "") for p in reader.pages)
                except Exception:  # noqa: BLE001
                    return []
            if f"({tkr})" not in txt:
                return []
            found: list[CongressTrade] = []
            for m in _PTR_ROW.finditer(txt):
                if m.group(1) != tkr:
                    continue
                lo, hi = _amount_bracket(m.group(4))
                found.append(CongressTrade(
                    disclosure_date=fd, transaction_date=_parse_date(m.group(3)),
                    member="(House filer)", chamber="house",
                    txn_type=_txn_type(m.group(2)), amount_low=lo, amount_high=hi,
                    note="parsed from House PTR PDF"))
            return found

        results = await asyncio.gather(*(_one(fd, doc) for fd, doc in filings))
    return [t for sub in results for t in sub]


# ----------------------------------------------------------------------------- public
async def fetch_congress_trades(
    ticker: str, *, since: date, as_of: date,
) -> tuple[list[CongressTrade], str]:
    """Return (trades sorted by disclosure date, provider label). Empty list if nothing found."""
    cached = _load_cache(ticker)
    if cached is not None:
        return cached

    provider = ""
    trades: list[CongressTrade] = []
    if os.environ.get("QUIVER_API_TOKEN"):
        try:
            trades = await _from_quiver(ticker)
            provider = "quiver"
        except Exception as e:  # noqa: BLE001
            logger.warning("task22_quiver_failed", error=str(e)[:160])
    if not trades and os.environ.get("FMP_API_KEY"):
        try:
            trades = await _from_fmp(ticker)
            provider = "fmp"
        except Exception as e:  # noqa: BLE001
            logger.warning("task22_fmp_failed_outer", error=str(e)[:160])
    if not trades:
        trades = await _free_house_ptr(ticker, since=since, as_of=as_of)
        provider = "house_ptr_free (partial)"

    trades = [t for t in trades if since <= t.disclosure_date <= as_of]
    trades.sort(key=lambda t: t.disclosure_date)
    _save_cache(ticker, trades, provider)
    logger.info("task22_congress_fetched", ticker=ticker, n=len(trades), provider=provider)
    return trades, provider
