"""Fetch a 10-K filing from SEC EDGAR (or any URL) and persist the raw HTML.

SEC requires a descriptive User-Agent on EDGAR requests:
  https://www.sec.gov/os/accessing-edgar-data
Bare scrapers get 403 / rate-limited. We send a fixed UA per the policy.

Returns a `FilingMeta` describing the source and the artifact key the raw HTML
was stored under.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from shared.artifacts import put_artifact
from shared.logging import get_logger
from shared.schemas import FilingMeta

logger = get_logger(__name__)

# SEC's policy says: "Sample Company Name AdminContact@<sample company domain>.com"
# Replace with your real contact in production.
SEC_USER_AGENT = "Whaleforce Interview Project chenchisheng (research, contact: chenchisheng@example.com)"

EDGAR_HOST_HINT = "sec.gov"

# Regex to mine CIK + accession from canonical EDGAR archive URLs, e.g.
# https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm
_EDGAR_PATH_RE = re.compile(
    r"/Archives/edgar/data/(?P<cik>\d+)/(?P<accession_nodashes>\d+)/", re.IGNORECASE
)


class IngestError(RuntimeError):
    pass


def _parse_edgar_metadata(url: str) -> tuple[str | None, str | None]:
    """Best-effort extraction of (CIK, accession-number) from an EDGAR URL.

    Returns (None, None) if the URL is not an EDGAR archive link — we still
    accept it but cannot infer metadata.
    """
    parsed = urlparse(url)
    if EDGAR_HOST_HINT not in (parsed.netloc or "").lower():
        return None, None
    m = _EDGAR_PATH_RE.search(parsed.path)
    if not m:
        return None, None
    cik = m.group("cik")
    raw_acc = m.group("accession_nodashes")
    # EDGAR canonical accession = "XXXXXXXXXX-YY-NNNNNN" (10-2-6 digits)
    if len(raw_acc) == 18:
        accession = f"{raw_acc[:10]}-{raw_acc[10:12]}-{raw_acc[12:]}"
    else:
        accession = raw_acc
    return cik, accession


async def fetch_filing(*, url: str, job_id: str) -> tuple[FilingMeta, str]:
    """Download a 10-K HTML document and persist it.

    Returns (FilingMeta, raw_html_text). The artifact is stored under
    `{job_id}/raw.html`.
    """
    if not url.startswith(("http://", "https://")):
        raise IngestError(f"URL must be absolute http(s): {url!r}")

    headers = {
        "User-Agent": SEC_USER_AGENT,
        "Accept": "text/html, application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate",
    }
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        logger.info("filing_fetch_start", url=url)
        resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            raise IngestError(
                f"HTTP {resp.status_code} from {url} (body: {resp.text[:200]!r})"
            )
        html = resp.text

    await put_artifact(f"{job_id}/raw.html", html.encode("utf-8"), "text/html")
    cik, accession = _parse_edgar_metadata(url)
    return (
        FilingMeta(
            cik=cik,
            accession_number=accession,
            source_url=url,
            fetched_at=datetime.now(timezone.utc),
        ),
        html,
    )
