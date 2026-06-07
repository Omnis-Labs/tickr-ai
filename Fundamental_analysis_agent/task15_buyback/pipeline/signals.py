"""Buyback signal from SEC XBRL diluted-share-count. Pure, deterministic, lookahead-free.

Reuses Task 11's companyfacts fetch + quarterly extractor for the diluted-shares
tag. The YoY change in share count (matched to the same fiscal quarter a year
earlier), computed only from filings known by date `d`, is the buyback signal.
"""

from __future__ import annotations

from datetime import date

from task11_fundamentals_trend.pipeline.companyfacts import _quarterly_series, fetch_companyfacts
from task15_buyback.schemas import SharePoint

_SHARE_TAGS = ["WeightedAverageNumberOfDilutedSharesOutstanding",
               "WeightedAverageNumberOfSharesOutstandingBasic"]

__all__ = ["fetch_companyfacts", "extract_shares", "shares_yoy_asof", "buyback_readings", "readings_block"]


def extract_shares(gaap: dict) -> list[SharePoint]:
    series = _quarterly_series(gaap, _SHARE_TAGS, unit="shares")   # share counts use the 'shares' unit
    out = [SharePoint(end=ed, filed=filed, fy=fy, fp=fp, diluted_shares=val)
           for ed, (filed, fy, fp, val) in series.items()]
    out.sort(key=lambda s: s.end)
    return out


def shares_yoy_asof(shares: list[SharePoint], d: date) -> dict | None:
    visible = [s for s in shares if s.filed <= d]
    if not visible:
        return None
    visible.sort(key=lambda s: s.end)
    latest = visible[-1]
    year_ago = next((s for s in visible if s.fy == latest.fy - 1 and s.fp == latest.fp), None)
    if year_ago is None or year_ago.diluted_shares <= 0:
        return {"shares": latest.diluted_shares, "yoy_change_pct": None, "has_yoy": False}
    chg = (latest.diluted_shares / year_ago.diluted_shares - 1.0) * 100.0
    return {"shares": latest.diluted_shares, "yoy_change_pct": chg, "has_yoy": True,
            "fy": latest.fy, "fp": latest.fp, "filed": latest.filed}


def buyback_readings(shares: list[SharePoint], d: date) -> dict[str, float | str]:
    m = shares_yoy_asof(shares, d)
    if m is None:
        return {"buyback_regime": "no_data", "n_quarters": 0.0}
    chg = m.get("yoy_change_pct")
    if chg is None:
        regime = "unknown"
    elif chg <= -1.0:
        regime = "buying_back"
    elif chg >= 1.0:
        regime = "diluting"
    else:
        regime = "flat"
    out: dict[str, float | str] = {
        "buyback_regime": regime, "n_quarters": float(len(shares)),
        "latest_period": f"FY{m.get('fy')} {m.get('fp')}" if m.get("has_yoy") else "n/a",
        "diluted_shares_millions": round(m["shares"] / 1e6, 1),
    }
    if chg is not None:
        out["shares_yoy_change_pct"] = round(chg, 2)
        out["net_repurchase_yoy_pct"] = round(-chg, 2)   # positive = shares reduced
    return out


def readings_block(r: dict[str, float | str]) -> str:
    order = ["buyback_regime", "n_quarters", "latest_period", "diluted_shares_millions",
             "shares_yoy_change_pct", "net_repurchase_yoy_pct"]
    lines = []
    for k in order:
        if k not in r:
            continue
        v = r[k]
        lines.append(f"- {k}: {v:+.2f}" if (isinstance(v, float) and k.endswith("_pct")) else f"- {k}: {v}")
    return "\n".join(lines)
