"""Fundamental-momentum metrics, computed strictly as-of a date (lookahead-free).

`metrics_asof` returns the most recent fiscal quarter known by date `d` plus its
year-over-year growth (matched to the same fiscal period a year earlier) and the
YoY change in gross margin. Both the LLM readings and the backtest's daily signal
are built on this, so they measure the same thing.
"""

from __future__ import annotations

from datetime import date

from task11_fundamentals_trend.schemas import QuarterPoint


def metrics_asof(quarters: list[QuarterPoint], d: date) -> dict | None:
    visible = [q for q in quarters if q.filed <= d]
    if not visible:
        return None
    visible.sort(key=lambda q: q.end)
    latest = visible[-1]
    # same fiscal period one year earlier
    year_ago = next((q for q in visible if q.fy == latest.fy - 1 and q.fp == latest.fp), None)

    def _yoy(cur: float | None, prev: float | None) -> float | None:
        if cur is None or prev is None or prev == 0:
            return None
        return (cur / abs(prev) - 1.0) * 100.0 if prev > 0 else None

    rev_yoy = _yoy(latest.revenue, year_ago.revenue if year_ago else None)
    ni_yoy = _yoy(latest.net_income, year_ago.net_income if year_ago else None)
    margin_now = (latest.gross_profit / latest.revenue * 100.0
                  if latest.gross_profit is not None and latest.revenue else None)
    margin_prev = (year_ago.gross_profit / year_ago.revenue * 100.0
                   if year_ago and year_ago.gross_profit is not None and year_ago.revenue else None)
    margin_chg = (margin_now - margin_prev) if (margin_now is not None and margin_prev is not None) else None

    return {
        "fy": latest.fy, "fp": latest.fp, "end": latest.end, "filed": latest.filed,
        "revenue_yoy_pct": rev_yoy, "earnings_yoy_pct": ni_yoy,
        "gross_margin_pct": margin_now, "margin_yoy_change_pp": margin_chg,
        "has_yoy": year_ago is not None,
    }


def readings_asof(quarters: list[QuarterPoint], d: date) -> dict[str, float | str]:
    m = metrics_asof(quarters, d)
    if m is None:
        return {"fundamentals_regime": "no_data", "n_quarters": 0.0}
    rev, ni, mc = m["revenue_yoy_pct"], m["earnings_yoy_pct"], m["margin_yoy_change_pp"]
    growing = (rev or 0) > 0 or (ni or 0) > 0
    margin_up = (mc or 0) > 0
    if growing and margin_up:
        regime = "improving"
    elif (rev is not None and rev < 0) and (ni is not None and ni < 0):
        regime = "deteriorating"
    else:
        regime = "mixed"
    out: dict[str, float | str] = {
        "fundamentals_regime": regime,
        "n_quarters": float(len(quarters)),
        "latest_period": f"FY{m['fy']} {m['fp']}",
        "latest_filed": m["filed"].isoformat(),
    }
    if rev is not None:
        out["revenue_yoy_pct"] = round(rev, 1)
    if ni is not None:
        out["earnings_yoy_pct"] = round(ni, 1)
    if m["gross_margin_pct"] is not None:
        out["gross_margin_pct"] = round(m["gross_margin_pct"], 1)
    if mc is not None:
        out["margin_yoy_change_pp"] = round(mc, 2)
    return out


def readings_block(r: dict[str, float | str]) -> str:
    order = ["fundamentals_regime", "n_quarters", "latest_period", "latest_filed",
             "revenue_yoy_pct", "earnings_yoy_pct", "gross_margin_pct", "margin_yoy_change_pp"]
    lines = []
    for k in order:
        if k not in r:
            continue
        v = r[k]
        lines.append(f"- {k}: {v:+.2f}" if (isinstance(v, float) and k.endswith(("_pct", "_pp")))
                     else f"- {k}: {v}")
    return "\n".join(lines)
