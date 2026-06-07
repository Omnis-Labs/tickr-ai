"""Fundamental-quality factors from SEC XBRL. Pure, deterministic, lookahead-free.

Reuses Task 11's companyfacts fetch + annual/instant extractors. `metrics_asof`
returns the Piotroski F-Score, accruals ratio and YoY asset growth as known by a
date `d` (latest fiscal year filed on/before d, vs the prior year). All point-in-
time (as-originally-filed).
"""

from __future__ import annotations

from datetime import date

from task11_fundamentals_trend.pipeline.companyfacts import (
    annual_series, fetch_companyfacts, instant_series,
)
from task17_quality.schemas import QualitySpec

__all__ = ["fetch_companyfacts", "build_bundle", "metrics_asof", "quality_readings",
           "readings_block", "wants_long"]

_REV = ["RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"]
_CFO = ["NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]
_LTD = ["LongTermDebtNoncurrent", "LongTermDebt"]


def build_bundle(gaap: dict) -> dict:
    """All series F-Score / accruals / asset-growth need, in one bundle."""
    return {
        "ni": annual_series(gaap, ["NetIncomeLoss"]),
        "cfo": annual_series(gaap, _CFO),
        "gp": annual_series(gaap, ["GrossProfit"]),
        "rev": annual_series(gaap, _REV),
        "shares": annual_series(gaap, ["WeightedAverageNumberOfDilutedSharesOutstanding",
                                       "WeightedAverageNumberOfSharesOutstandingBasic"], unit="shares"),
        "assets": instant_series(gaap, ["Assets"]),
        "ca": instant_series(gaap, ["AssetsCurrent"]),
        "cl": instant_series(gaap, ["LiabilitiesCurrent"]),
        "ltd": instant_series(gaap, _LTD),
    }


def _val(series: dict, d: date) -> float | None:
    v = series.get(d)
    return v[1] if v else None


def metrics_asof(bundle: dict, d: date) -> dict | None:
    ni = bundle["ni"]
    # latest fiscal year-end filed on/before d, and the prior year-end
    ends = sorted(e for e, (filed, _) in ni.items() if filed <= d)
    if len(ends) < 2:
        return None
    et, ep = ends[-1], ends[-2]
    filed = ni[et][0]

    def g(series, e):
        return _val(series, e)

    ni_t, ni_p = g(ni, et), g(ni, ep)
    cfo_t = g(bundle["cfo"], et)
    a_t, a_p = g(bundle["assets"], et), g(bundle["assets"], ep)
    ca_t, ca_p = g(bundle["ca"], et), g(bundle["ca"], ep)
    cl_t, cl_p = g(bundle["cl"], et), g(bundle["cl"], ep)
    ltd_t, ltd_p = g(bundle["ltd"], et), g(bundle["ltd"], ep)
    gp_t, gp_p = g(bundle["gp"], et), g(bundle["gp"], ep)
    rev_t, rev_p = g(bundle["rev"], et), g(bundle["rev"], ep)
    sh_t, sh_p = g(bundle["shares"], et), g(bundle["shares"], ep)

    def roa(n, a):
        return (n / a) if (n is not None and a) else None

    # Piotroski F-Score (each criterion scores 1 when satisfied, 0 if unknown)
    pts = []
    pts.append(1 if (roa(ni_t, a_t) or 0) > 0 else 0)                                   # 1 ROA>0
    pts.append(1 if (cfo_t or 0) > 0 else 0)                                            # 2 CFO>0
    rt, rp = roa(ni_t, a_t), roa(ni_p, a_p)
    pts.append(1 if (rt is not None and rp is not None and rt > rp) else 0)             # 3 ΔROA>0
    pts.append(1 if (cfo_t is not None and ni_t is not None and cfo_t > ni_t) else 0)   # 4 accrual: CFO>NI
    lev_t = (ltd_t / a_t) if (ltd_t is not None and a_t) else None
    lev_p = (ltd_p / a_p) if (ltd_p is not None and a_p) else None
    pts.append(1 if (lev_t is not None and lev_p is not None and lev_t < lev_p) else 0)  # 5 ΔLeverage<0
    cr_t = (ca_t / cl_t) if (ca_t is not None and cl_t) else None
    cr_p = (ca_p / cl_p) if (ca_p is not None and cl_p) else None
    pts.append(1 if (cr_t is not None and cr_p is not None and cr_t > cr_p) else 0)     # 6 ΔCurrentRatio>0
    pts.append(1 if (sh_t is not None and sh_p is not None and sh_t <= sh_p * 1.001) else 0)  # 7 no dilution
    gm_t = (gp_t / rev_t) if (gp_t is not None and rev_t) else None
    gm_p = (gp_p / rev_p) if (gp_p is not None and rev_p) else None
    pts.append(1 if (gm_t is not None and gm_p is not None and gm_t > gm_p) else 0)     # 8 ΔGrossMargin>0
    at_t = (rev_t / a_t) if (rev_t is not None and a_t) else None
    at_p = (rev_p / a_p) if (rev_p is not None and a_p) else None
    pts.append(1 if (at_t is not None and at_p is not None and at_t > at_p) else 0)     # 9 ΔAssetTurnover>0
    f_score = sum(pts)

    accruals_pct = ((ni_t - cfo_t) / a_t * 100.0) if (ni_t is not None and cfo_t is not None and a_t) else None
    asset_growth_pct = ((a_t / a_p - 1.0) * 100.0) if (a_t and a_p) else None

    return {
        "fy_end": et, "filed": filed, "f_score": f_score,
        "accruals_pct": accruals_pct, "asset_growth_pct": asset_growth_pct,
        "roa_pct": (rt * 100.0) if rt is not None else None,
    }


def quality_readings(bundle: dict, d: date) -> dict[str, float | str]:
    m = metrics_asof(bundle, d)
    if m is None:
        return {"quality_regime": "no_data"}
    fs = m["f_score"]
    regime = "high_quality" if fs >= 7 else "weak" if fs <= 3 else "mixed"
    out: dict[str, float | str] = {
        "quality_regime": regime, "f_score": float(fs), "latest_fy_end": m["fy_end"].isoformat(),
        "latest_filed": m["filed"].isoformat(),
    }
    if m["roa_pct"] is not None:
        out["roa_pct"] = round(m["roa_pct"], 1)
    if m["accruals_pct"] is not None:
        out["accruals_pct"] = round(m["accruals_pct"], 1)
    if m["asset_growth_pct"] is not None:
        out["asset_growth_pct"] = round(m["asset_growth_pct"], 1)
    return out


def readings_block(r: dict[str, float | str]) -> str:
    order = ["quality_regime", "f_score", "roa_pct", "accruals_pct", "asset_growth_pct",
             "latest_fy_end", "latest_filed"]
    lines = []
    for k in order:
        if k not in r:
            continue
        v = r[k]
        lines.append(f"- {k}: {v:+.1f}" if (isinstance(v, float) and k.endswith("_pct")) else f"- {k}: {v}")
    return "\n".join(lines)


def wants_long(spec: QualitySpec, bundle: dict, d: date) -> bool:
    m = metrics_asof(bundle, d)
    if m is None:
        return False
    fs, acc, ag = m["f_score"], m["accruals_pct"], m["asset_growth_pct"]
    f_ok = fs >= spec.f_threshold
    acc_ok = acc is not None and acc <= spec.max_accruals_pct
    ag_ok = ag is not None and ag <= spec.max_asset_growth_pct
    sig = spec.entry_signal
    if sig == "buy_and_hold":
        return True
    if sig == "f_score":
        return f_ok
    if sig == "low_accruals":
        return acc_ok
    if sig == "low_asset_growth":
        return ag_ok
    if sig == "composite_quality":
        return f_ok and acc_ok and ag_ok
    return False
