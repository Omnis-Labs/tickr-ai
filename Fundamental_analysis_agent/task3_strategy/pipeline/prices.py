"""Price ingestion behind a pluggable provider, with an on-disk cache.

`fetch_prices()` keeps one stable signature for every agent; the actual source is
chosen by `settings.price_provider`:

  * **yfinance** (default) — free, but unofficial, rate-limited, and personal-use
    only under Yahoo's ToS. Fine for development / personal use.
  * **tiingo** — a licensed EOD feed for a real product. Needs `TIINGO_API_KEY`.

Selection is fully behind this function: switching feeds is a one-line config
change, and a paid provider that errors or has no key **falls back to yfinance**
so the app never hard-breaks on a feed outage. Both providers return
split/dividend-adjusted OHLCV (un-adjusted prices make a multi-year backtest
silently wrong around any split). The cache is keyed by provider so the two feeds
never get mixed.
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
_HISTORY_YEARS = 10


def _cache_path(ticker: str, provider: str) -> Path:
    base = Path(get_settings().artifact_dir) / "prices"
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{ticker.upper()}.{provider}.json"


def _load_cache(ticker: str, provider: str) -> list[PricePoint] | None:
    p = _cache_path(ticker, provider)
    if not p.exists():
        return None
    try:
        blob = json.loads(p.read_text())
        if datetime.now(timezone.utc) - datetime.fromisoformat(blob["fetched_at"]) > _CACHE_TTL:
            return None
        return [PricePoint(**row) for row in blob["prices"]]
    except Exception as e:  # noqa: BLE001
        logger.warning("price_cache_read_failed", ticker=ticker, error=str(e)[:160])
        return None


def _save_cache(ticker: str, provider: str, prices: list[PricePoint]) -> None:
    blob = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "prices": [json.loads(pp.model_dump_json()) for pp in prices],
    }
    _cache_path(ticker, provider).write_text(json.dumps(blob))


# --- providers --------------------------------------------------------------

def _fetch_yfinance(ticker: str) -> list[PricePoint]:
    import yfinance as yf  # local import — heavy dependency

    df = yf.Ticker(ticker).history(period=f"{_HISTORY_YEARS}y", auto_adjust=True)
    if df is None or df.empty:
        raise RuntimeError(f"no price data for ticker {ticker!r}")
    out = [
        PricePoint(
            date=ts.date(),
            open=round(float(row["Open"]), 4), high=round(float(row["High"]), 4),
            low=round(float(row["Low"]), 4), close=round(float(row["Close"]), 4),
            volume=float(row["Volume"]),
        )
        for ts, row in df.iterrows()
    ]
    return out


def _fetch_tiingo(ticker: str) -> list[PricePoint]:
    """Tiingo daily EOD, split/dividend-adjusted (adj* fields). Needs TIINGO_API_KEY."""
    import httpx

    key = get_settings().tiingo_api_key
    if not key:
        raise RuntimeError("price_provider=tiingo but TIINGO_API_KEY is not set")
    start = (datetime.now(timezone.utc).date() - timedelta(days=365 * _HISTORY_YEARS)).isoformat()
    url = f"https://api.tiingo.com/tiingo/daily/{ticker}/prices"
    resp = httpx.get(
        url, params={"startDate": start, "format": "json"},
        headers={"Authorization": f"Token {key}", "Content-Type": "application/json"},
        timeout=30.0,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not isinstance(rows, list) or not rows:
        raise RuntimeError(f"no Tiingo price data for ticker {ticker!r}")
    out = []
    for r in rows:
        # prefer adjusted fields; fall back to raw if a row lacks them
        o, h, l, c = (r.get("adjOpen", r["open"]), r.get("adjHigh", r["high"]),
                      r.get("adjLow", r["low"]), r.get("adjClose", r["close"]))
        out.append(PricePoint(
            date=date.fromisoformat(r["date"][:10]),
            open=round(float(o), 4), high=round(float(h), 4),
            low=round(float(l), 4), close=round(float(c), 4),
            volume=float(r.get("adjVolume", r.get("volume", 0)) or 0),
        ))
    return out


_PROVIDERS = {"yfinance": _fetch_yfinance, "tiingo": _fetch_tiingo}


def fetch_prices(
    ticker: str, *, start: date | None = None, end: date | None = None
) -> list[PricePoint]:
    """Return daily split/dividend-adjusted OHLCV for `ticker`, ascending by date.

    Source is `settings.price_provider` (cached 1 day). A non-default provider that
    errors falls back to yfinance so a feed outage never hard-breaks the app.
    Raises RuntimeError only if no source returns data.
    """
    provider = get_settings().price_provider
    cached = _load_cache(ticker, provider)
    if cached is not None:
        out = cached
    else:
        try:
            out = _PROVIDERS.get(provider, _fetch_yfinance)(ticker)
            used = provider
        except Exception as e:  # noqa: BLE001
            if provider != "yfinance":
                logger.warning("price_provider_fallback", provider=provider,
                               ticker=ticker, error=str(e)[:160])
                out = _fetch_yfinance(ticker)   # may itself raise → propagates
                used = "yfinance"
            else:
                raise
        if not out:
            raise RuntimeError(f"no price data for ticker {ticker!r}")
        out.sort(key=lambda p: p.date)
        _save_cache(ticker, used, out)
        logger.info("prices_fetched", ticker=ticker, n=len(out), provider=used)

    if start:
        out = [p for p in out if p.date >= start]
    if end:
        out = [p for p in out if p.date <= end]
    return out
