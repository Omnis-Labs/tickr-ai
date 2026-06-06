"""EDGAR submissions API helper — resolve CIK + fiscal-year-end → 10-K URL.

EDGAR exposes per-company filing history at:
  https://data.sec.gov/submissions/CIK{padded10digit}.json

That JSON has a `filings.recent` block listing recent filings. We filter by
formType == '10-K', pick the desired fiscal-year-end (or latest), and assemble
the canonical archive URL.

Usage:
    python -m task2_10k_extractor.eval.edgar_lookup --cik 320193 --year 2023
    python -m task2_10k_extractor.eval.edgar_lookup --build-eval-set
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import yaml

from shared.config import get_settings

# Same SEC-compliant UA as ingest.py — EDGAR rate-limits anonymous scrapers.
SEC_UA = "Whaleforce Interview Project (research, contact: chenchisheng@example.com)"

_SEC_HEADERS = {"User-Agent": SEC_UA, "Accept": "application/json"}

# SEC throttles to ~10 req/s and returns 429 (sometimes 503) when exceeded.
# Retry with backoff so a transient throttle doesn't fail the whole job.
_SEC_MAX_RETRIES = 4


async def _sec_get_json(url: str) -> dict:
    """GET a SEC JSON endpoint, retrying on 429/503 with backoff.

    Honours the `Retry-After` header when present, otherwise falls back to
    exponential backoff (0.5, 1, 2, 4s). Non-retryable statuses raise
    immediately via `raise_for_status()`.
    """
    last_exc: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for attempt in range(_SEC_MAX_RETRIES):
            resp = await client.get(url, headers=_SEC_HEADERS)
            if resp.status_code in (429, 503) and attempt < _SEC_MAX_RETRIES - 1:
                retry_after = resp.headers.get("Retry-After", "")
                delay = (
                    float(retry_after)
                    if retry_after.isdigit()
                    else 0.5 * (2 ** attempt)
                )
                last_exc = httpx.HTTPStatusError(
                    f"HTTP {resp.status_code} from {url}",
                    request=resp.request,
                    response=resp,
                )
                await asyncio.sleep(delay)
                continue
            resp.raise_for_status()
            return resp.json()
    # Unreachable in practice (loop either returns or raises), but keeps types honest.
    raise last_exc if last_exc else RuntimeError(f"unreachable: {url}")

# CIKs picked to span industries × format era × size.
# Sourced from EDGAR's company search. Format era inferred from year:
#   pre-2017 → mostly plain HTML; 2017+ → iXBRL standard.
KNOWN_CIKS: dict[str, dict[str, str | int]] = {
    "AAPL": {"cik": 320193, "industry": "tech", "fye_month": 9},
    "MSFT": {"cik": 789019, "industry": "tech", "fye_month": 6},
    "GOOG": {"cik": 1652044, "industry": "tech", "fye_month": 12},
    "META": {"cik": 1326801, "industry": "tech", "fye_month": 12},
    "JPM":  {"cik": 19617,  "industry": "bank", "fye_month": 12},
    "BAC":  {"cik": 70858,  "industry": "bank", "fye_month": 12},
    "XOM":  {"cik": 34088,  "industry": "energy", "fye_month": 12},
    "CVX":  {"cik": 93410,  "industry": "energy", "fye_month": 12},
    "WMT":  {"cik": 104169, "industry": "retail", "fye_month": 1},
    "TGT":  {"cik": 27419,  "industry": "retail", "fye_month": 1},
    "PFE":  {"cik": 78003,  "industry": "pharma", "fye_month": 12},
    "JNJ":  {"cik": 200406, "industry": "pharma", "fye_month": 12},
    "SPG":  {"cik": 1040971, "industry": "reit", "fye_month": 12},
    "BA":   {"cik": 12927,  "industry": "industrial", "fye_month": 12},
}


# SIC (Standard Industrial Classification) → coarse industry bucket. Tickers not
# in KNOWN_CIKS get their industry derived from the `sic` field SEC returns on
# every submissions record, so we no longer fall back to a blind "unknown".
# Ranges are checked in order; first match wins (so the narrow auto range is
# listed before the broad transport-equipment range). Buckets mirror the
# vocabulary used in KNOWN_CIKS, plus "auto" for motor vehicles.
_SIC_INDUSTRY_RANGES: list[tuple[int, int, str]] = [
    (2833, 2836, "pharma"),      # medicinal chemicals & biological products
    (3570, 3579, "tech"),        # computers & office equipment
    (3600, 3674, "tech"),        # electronics & semiconductors
    (7370, 7379, "tech"),        # software & IT services
    (3711, 3716, "auto"),        # motor vehicles & car bodies/parts
    (6020, 6036, "bank"),        # commercial banks & savings institutions
    (1300, 1399, "energy"),      # crude petroleum & natural gas extraction
    (2900, 2999, "energy"),      # petroleum refining
    (5200, 5999, "retail"),      # retail trade
    (6798, 6798, "reit"),        # real estate investment trusts
    (3400, 3569, "industrial"),  # fabricated metal & machinery
    (3700, 3799, "industrial"),  # other transportation equipment (aircraft etc.)
]


def _industry_from_sic(sic: object) -> str:
    """Map a SEC SIC code to a coarse industry bucket, or 'unknown'."""
    try:
        code = int(sic)  # SEC returns sic as int or numeric string
    except (TypeError, ValueError):
        return "unknown"
    for low, high, bucket in _SIC_INDUSTRY_RANGES:
        if low <= code <= high:
            return bucket
    return "unknown"


@dataclass
class FilingRef:
    ticker: str
    cik: int
    industry: str
    fiscal_year: int
    accession_number: str
    primary_document: str
    filed_date: str

    @property
    def url(self) -> str:
        # Canonical archive URL: /Archives/edgar/data/{cik}/{accession-no-dashes}/{primary_doc}
        nodashes = self.accession_number.replace("-", "")
        return f"https://www.sec.gov/Archives/edgar/data/{self.cik}/{nodashes}/{self.primary_document}"


async def fetch_submissions(cik: int) -> dict:
    padded = f"CIK{cik:010d}"
    url = f"https://data.sec.gov/submissions/{padded}.json"
    return await _sec_get_json(url)


# SEC's public ticker-to-CIK mapping. Single download (~1.6 MB) covers every
# SEC-registered ticker. Cached in-process so we hit it at most once per
# Python process, AND persisted to disk so cold jobs don't re-download it (and
# trip SEC's rate limit) every time. The CIK map changes slowly, so a weekly
# refresh is plenty.
_SEC_TICKER_MAP: dict[str, int] | None = None
_SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
_TICKER_MAP_TTL_S = 7 * 24 * 3600  # weekly


def _ticker_cache_path() -> Path:
    # Sits alongside the SQLite db / artifacts under ./data by default.
    return Path(get_settings().artifact_dir).parent / "sec_ticker_map.json"


def _read_ticker_cache(*, max_age_s: float | None) -> dict[str, int] | None:
    """Load the cached ticker→CIK map, or None if absent/stale/corrupt.

    `max_age_s=None` ignores age — used as a last-resort fallback when SEC is
    throttling and a fresh download is impossible.
    """
    path = _ticker_cache_path()
    try:
        age = time.time() - path.stat().st_mtime
    except OSError:
        return None
    if max_age_s is not None and age > max_age_s:
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return {str(k).upper(): v for k, v in raw.items() if isinstance(v, int)}


def _write_ticker_cache(mapping: dict[str, int]) -> None:
    path = _ticker_cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(mapping), encoding="utf-8")
    except OSError:
        pass  # cache is best-effort; never fail a lookup over it


async def fetch_sec_ticker_map() -> dict[str, int]:
    """Return a UPPERCASE-ticker → CIK mapping for every SEC filer.

    Schema from SEC: `{"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}`

    Lookup order: in-process cache → fresh disk cache → SEC download →
    stale disk cache (if SEC is throttling). Only raises if every layer fails.
    """
    global _SEC_TICKER_MAP
    if _SEC_TICKER_MAP is not None:
        return _SEC_TICKER_MAP

    fresh = _read_ticker_cache(max_age_s=_TICKER_MAP_TTL_S)
    if fresh is not None:
        _SEC_TICKER_MAP = fresh
        return fresh

    try:
        data = await _sec_get_json(_SEC_TICKER_MAP_URL)
    except httpx.HTTPError:
        # SEC unreachable / throttling — fall back to a stale copy if we have one.
        stale = _read_ticker_cache(max_age_s=None)
        if stale is not None:
            _SEC_TICKER_MAP = stale
            return stale
        raise

    out: dict[str, int] = {}
    for entry in data.values():
        ticker = str(entry.get("ticker", "")).upper().strip()
        cik = entry.get("cik_str")
        if ticker and isinstance(cik, int):
            out[ticker] = cik
    _write_ticker_cache(out)
    _SEC_TICKER_MAP = out
    return out


async def fetch_all_historical(cik: int) -> dict:
    """Fetch submissions PLUS all paginated historical files.

    EDGAR's `filings.recent` block only contains the last ~1000 filings;
    older history lives under `filings.files[].name`. For 10-Ks specifically
    (one per year), large-cap filers' history typically extends back 20+
    years.

    Returns a single dict with `recent` lists *concatenated* with all
    historical pages. Same field layout as the original recent block.
    """
    padded = f"CIK{cik:010d}"
    main = await fetch_submissions(cik)
    files = main.get("filings", {}).get("files", []) or []
    combined = dict(main["filings"]["recent"])  # shallow copy of lists
    keys = list(combined.keys())
    for f in files:
        name = f.get("name")
        if not name:
            continue
        url = f"https://data.sec.gov/submissions/{name}"
        try:
            page = await _sec_get_json(url)
        except Exception:
            continue
        for k in keys:
            page_list = page.get(k, [])
            if isinstance(page_list, list):
                combined[k] = list(combined[k]) + list(page_list)
    out = dict(main)
    out.setdefault("filings", {})
    out["filings"]["recent"] = combined
    return out


def _pick_10k_filing(
    submissions: dict, *, fiscal_year: int | None
) -> tuple[str, str, str, int] | None:
    """Return (accession_number, primary_doc, filed_date, fiscal_year) for a 10-K.

    If `fiscal_year` is None → return the most recently filed 10-K.
    Otherwise → match `reportDate` year (e.g. reportDate=2023-09-30 → FY 2023).

    Note: EDGAR's `filings.recent` only contains the last ~1000 filings or
    one rolling year, whichever is larger. Older 10-Ks live under
    `filings.files[].name` and need a separate fetch. For interview-scale
    eval (recent filings only), `recent` is sufficient.
    """
    recent = submissions.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])
    filed_dates = recent.get("filingDate", [])
    report_dates = recent.get("reportDate", [])

    candidates: list[tuple[str, str, str, int]] = []
    for i, form in enumerate(forms):
        if form != "10-K":
            continue
        report_date = report_dates[i] if i < len(report_dates) else ""
        if not report_date:
            continue
        report_year = int(report_date.split("-")[0])
        candidates.append(
            (accessions[i], primary_docs[i], filed_dates[i], report_year)
        )

    if fiscal_year is not None:
        for c in candidates:
            if c[3] == fiscal_year:
                return c
        return None
    # latest by filing date
    if not candidates:
        return None
    return max(candidates, key=lambda c: c[2])


async def resolve_filing(
    ticker: str, *, fiscal_year: int | None = None
) -> FilingRef | None:
    """Resolve a ticker (+ optional fiscal year) to an EDGAR FilingRef.

    Lookup order:
      1. Our curated KNOWN_CIKS — gives industry metadata for the eval set.
      2. SEC's public ticker→CIK map — covers every SEC-registered filer
         (~13k entries). Industry derived from the filing's SIC code.

    Raises KeyError only if neither layer recognises the ticker.
    """
    t = ticker.strip().upper()
    meta = KNOWN_CIKS.get(t)
    if meta is not None:
        cik = int(meta["cik"])
        industry = str(meta["industry"])
    else:
        sec_map = await fetch_sec_ticker_map()
        if t not in sec_map:
            raise KeyError(f"ticker {t!r} not in our KNOWN_CIKS nor in SEC's public ticker map")
        cik = sec_map[t]
        industry = ""  # derived from the SIC code once submissions are fetched
    submissions = await fetch_submissions(cik)
    if not industry:
        industry = _industry_from_sic(submissions.get("sic"))
    picked = _pick_10k_filing(submissions, fiscal_year=fiscal_year)
    if picked is None and fiscal_year is not None:
        # Specific year requested but missing from `recent` — fall through
        # to paginated historical files. Costs an extra fetch per file, ~5
        # files for a 20-year-old filer.
        submissions = await fetch_all_historical(cik)
        picked = _pick_10k_filing(submissions, fiscal_year=fiscal_year)
    if picked is None:
        return None
    accession, primary, filed, fy = picked
    return FilingRef(
        ticker=t,
        cik=cik,
        industry=industry,
        fiscal_year=fy,
        accession_number=accession,
        primary_document=primary,
        filed_date=filed,
    )


async def build_eval_set(year: int | None = None) -> list[dict]:
    """Resolve the most-recent 10-K URL for every known ticker.

    Pass year=None (default) to take the latest 10-K per filer. Pass an
    explicit year to require that fiscal year exactly. Tickers without a
    matching filing in EDGAR's `recent` block are skipped (not an error —
    older filings live in paginated history).
    """
    cases: list[dict] = []
    for ticker in KNOWN_CIKS:
        try:
            ref = await resolve_filing(ticker, fiscal_year=year)
        except Exception as e:  # noqa: BLE001
            print(f"  [skip] {ticker}: {e}", file=sys.stderr)
            continue
        if ref is None:
            print(f"  [skip] {ticker}: no 10-K in `recent` block", file=sys.stderr)
            continue
        cases.append(
            {
                "id": f"{ticker.lower()}-{ref.fiscal_year}",
                "industry": ref.industry,
                "company": ticker,
                "fiscal_year": ref.fiscal_year,
                "url": ref.url,
                "filed_date": ref.filed_date,
                "assertions": {
                    "min_items_found": 14,
                    "required_item_ids": ["1", "1A", "7", "8"],
                    "min_overall_confidence": 0.50,
                    "max_quarantined": False,
                    "max_cost_usd": 0.10,
                    "max_duration_ms": 30_000,
                },
            }
        )
    return cases


async def _cli() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker")
    parser.add_argument("--cik", type=int)
    parser.add_argument(
        "--year",
        type=int,
        default=None,
        help="Specific fiscal year (omit for latest available in EDGAR recent block)",
    )
    parser.add_argument(
        "--build-eval-set",
        action="store_true",
        help="Generate an eval_set.yaml-style block for every ticker in KNOWN_CIKS",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="If set with --build-eval-set, write the generated cases to this path",
    )
    args = parser.parse_args()

    if args.build_eval_set:
        cases = await build_eval_set(year=args.year)
        out = {"cases": cases}
        text = yaml.safe_dump(out, sort_keys=False, allow_unicode=True)
        if args.output:
            Path(args.output).write_text(text, encoding="utf-8")
            print(f"wrote {len(cases)} cases to {args.output}", file=sys.stderr)
        else:
            print(text)
        return 0

    if args.ticker:
        ref = await resolve_filing(args.ticker, fiscal_year=args.year)
    elif args.cik:
        meta = next((t for t, m in KNOWN_CIKS.items() if m["cik"] == args.cik), None)
        ticker = meta or "UNKNOWN"
        ref = await resolve_filing(ticker, fiscal_year=args.year)
    else:
        parser.error("provide --ticker, --cik, or --build-eval-set")

    if ref is None:
        print("no filing found", file=sys.stderr)
        return 1
    print(json.dumps(ref.__dict__ | {"url": ref.url}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_cli()))
