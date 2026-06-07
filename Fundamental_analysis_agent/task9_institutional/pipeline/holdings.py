"""Aggregate tracked-fund 13F holdings into an as-of timeline + readings.

A fund's reported holding persists until its next 13F updates it, so the
aggregate held-shares is a step function over filing dates. Everything is keyed
off filing dates → lookahead-free.
"""

from __future__ import annotations

from datetime import date, timedelta

from task9_institutional.schemas import FundHolding, FundSummary


def build_series(holdings: list[FundHolding]) -> dict[str, list[tuple[date, float]]]:
    series: dict[str, list[tuple[date, float]]] = {}
    for h in holdings:
        series.setdefault(h.fund_name, []).append((h.filing_date, h.shares))
    for f in series:
        series[f].sort(key=lambda x: x[0])
    return series


def _fund_shares_asof(points: list[tuple[date, float]], d: date) -> float:
    latest = 0.0
    for fd, sh in points:
        if fd <= d:
            latest = sh
        else:
            break
    return latest


def shares_asof(series: dict[str, list[tuple[date, float]]], d: date) -> float:
    return sum(_fund_shares_asof(p, d) for p in series.values())


def n_funds_holding_asof(series: dict[str, list[tuple[date, float]]], d: date) -> int:
    return sum(1 for p in series.values() if _fund_shares_asof(p, d) > 0)


def fund_summaries(series: dict[str, list[tuple[date, float]]], as_of: date) -> list[FundSummary]:
    out: list[FundSummary] = []
    for fund, pts in series.items():
        visible = [(d, s) for d, s in pts if d <= as_of]
        if not visible:
            out.append(FundSummary(fund_name=fund, latest_shares=0.0, change="absent"))
            continue
        last_d, last_s = visible[-1]
        prev_s = visible[-2][1] if len(visible) >= 2 else 0.0
        if last_s <= 0:
            change = "exited"
        elif prev_s <= 0:
            change = "new"
        elif last_s > prev_s * 1.02:
            change = "added"
        elif last_s < prev_s * 0.98:
            change = "trimmed"
        else:
            change = "held"
        out.append(FundSummary(fund_name=fund, latest_shares=last_s,
                               latest_filing_date=last_d, change=change))
    out.sort(key=lambda f: f.latest_shares, reverse=True)
    return out


def readings_asof(
    series: dict[str, list[tuple[date, float]]], as_of: date, lookback_days: int,
) -> dict[str, float | str]:
    if not series:
        return {"institutional_regime": "no_tracked_holders", "n_funds_holding": 0.0}
    cur = shares_asof(series, as_of)
    past = shares_asof(series, as_of - timedelta(days=lookback_days))
    n_now = n_funds_holding_asof(series, as_of)
    sums = fund_summaries(series, as_of)
    if cur <= 0:
        regime = "not_held"
    elif past <= 0 or cur > past * 1.02:
        regime = "accumulating"
    elif cur < past * 0.98:
        regime = "distributing"
    else:
        regime = "steady"
    return {
        "institutional_regime": regime,
        "n_funds_holding": float(n_now),
        "total_shares_held": round(cur, 0),
        "shares_change_pct": round((cur / past - 1.0) * 100.0, 1) if past > 0 else 0.0,
        "lookback_days": float(lookback_days),
        "n_added": float(sum(1 for s in sums if s.change in ("new", "added"))),
        "n_trimmed": float(sum(1 for s in sums if s.change in ("trimmed", "exited"))),
        "top_holder": sums[0].fund_name if sums and sums[0].latest_shares > 0 else "none",
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["institutional_regime", "n_funds_holding", "total_shares_held",
             "shares_change_pct", "lookback_days", "n_added", "n_trimmed", "top_holder"]
    lines = []
    for k in order:
        if k not in r:
            continue
        v = r[k]
        lines.append(f"- {k}: {v:+.1f}" if (isinstance(v, float) and k == "shares_change_pct")
                     else f"- {k}: {v}")
    return "\n".join(lines)
