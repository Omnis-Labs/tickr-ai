"""Price ingestion via yfinance, with an on-disk cache.

yfinance is unofficial and rate-limits, so every fetch is cached to
`artifact_dir/prices/<TICKER>.json`. We request `auto_adjust=True` so the close
is adjusted for splits and dividends — un-adjusted prices make a multi-year
backtest silently wrong around any split.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from shared.config import get_settings
from shared.logging import get_logger

from task3_strategy.schemas import PricePoint

logger = get_logger(__name__)

_CACHE_TTL = timedelta(days=1)


def _cache_path(ticker: str) -> Path:
    base = Path(get_settings().artifact_dir) / "prices"
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{ticker.upper()}.json"


def _load_cache(ticker: str) -> list[PricePoint] | None:
    p = _cache_path(ticker)
    if not p.exists():
        return None
    try:
        blob = json.loads(p.read_text())
        fetched = datetime.fromisoformat(blob["fetched_at"])
        if datetime.now(timezone.utc) - fetched > _CACHE_TTL:
            return None
        return [PricePoint(**row) for row in blob["prices"]]
    except Exception as e:  # noqa: BLE001
        logger.warning("price_cache_read_failed", ticker=ticker, error=str(e)[:160])
        return None


def _save_cache(ticker: str, prices: list[PricePoint]) -> None:
    blob = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "prices": [json.loads(pp.model_dump_json()) for pp in prices],
    }
    _cache_path(ticker).write_text(json.dumps(blob))


def fetch_prices(
    ticker: str, *, start: date | None = None, end: date | None = None
) -> list[PricePoint]:
    """Return daily OHLCV for `ticker`, ascending by date. Cached for 1 day.

    Raises RuntimeError if no data is returned (delisted / bad ticker / network).
    """
    cached = _load_cache(ticker)
    if cached is not None:
        out = cached
    else:
        import yfinance as yf  # local import — heavy dependency

        # 10y is plenty for a recent 10-K (we only chart ~1y pre-filing + the
        # post-filing window); much lighter to download/parse than "max".
        df = yf.Ticker(ticker).history(period="10y", auto_adjust=True)
        if df is None or df.empty:
            raise RuntimeError(f"no price data for ticker {ticker!r}")
        out = []
        for ts, row in df.iterrows():
            out.append(
                PricePoint(
                    date=ts.date(),
                    open=round(float(row["Open"]), 4),
                    high=round(float(row["High"]), 4),
                    low=round(float(row["Low"]), 4),
                    close=round(float(row["Close"]), 4),
                    volume=float(row["Volume"]),
                )
            )
        out.sort(key=lambda p: p.date)
        _save_cache(ticker, out)
        logger.info("prices_fetched", ticker=ticker, n=len(out))

    if start:
        out = [p for p in out if p.date >= start]
    if end:
        out = [p for p in out if p.date <= end]
    return out
