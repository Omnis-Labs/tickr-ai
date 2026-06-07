"""Resolve a ticker's sector benchmark ETF (for relative-strength).

Strategy: ticker → CIK (cached SEC ticker map) → SEC `sic` → coarse industry
bucket (reusing Task 2's mapping) → SPDR sector ETF. Anything we can't classify
(foreign ADRs with no CIK, ETFs, unknown SIC) falls back to SPY, so the agent
always has a benchmark and degrades to "relative to the market".
"""

from __future__ import annotations

from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import (
    _industry_from_sic,
    fetch_sec_ticker_map,
    fetch_submissions,
)

logger = get_logger(__name__)

# Coarse industry bucket (from Task 2's SIC map) → SPDR sector ETF.
_BUCKET_ETF: dict[str, tuple[str, str]] = {
    "tech": ("XLK", "Technology"),
    "pharma": ("XLV", "Health Care"),
    "bank": ("XLF", "Financials"),
    "energy": ("XLE", "Energy"),
    "auto": ("XLY", "Consumer Discretionary"),
    "retail": ("XLY", "Consumer Discretionary"),
    "reit": ("XLRE", "Real Estate"),
    "industrial": ("XLI", "Industrials"),
}
_FALLBACK = ("SPY", "Market (S&P 500)")


async def resolve_sector_etf(ticker: str) -> tuple[str, str]:
    """Return (etf_symbol, sector_label). Never raises — falls back to SPY."""
    ticker = ticker.strip().upper()
    if ticker in _BUCKET_ETF or ticker in {"SPY", "XLK", "XLV", "XLF", "XLE", "XLY", "XLRE", "XLI"}:
        # the ticker IS a sector ETF (or maps directly) → benchmark against the market
        return _FALLBACK
    try:
        tmap = await fetch_sec_ticker_map()
        cik = tmap.get(ticker)
        if cik is None:
            return _FALLBACK
        subs = await fetch_submissions(cik)
        bucket = _industry_from_sic(subs.get("sic"))
        etf = _BUCKET_ETF.get(bucket, _FALLBACK)
        logger.info("task7_sector_resolved", ticker=ticker, sic=subs.get("sic"),
                    bucket=bucket, etf=etf[0])
        return etf
    except Exception as e:  # noqa: BLE001
        logger.warning("task7_sector_resolve_failed", ticker=ticker, error=str(e)[:160])
        return _FALLBACK
