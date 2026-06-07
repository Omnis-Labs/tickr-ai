"""Cross-sectional factor math. Pure, deterministic, lookahead-free.

Each name's aligned close series lives on the common trading-day axis. At bar i the
factor is measured from closes STRICTLY BEFORE i (indices ≤ i-1), so the top-N
membership applied at bar i never peeks at bar-i's own move. Four factors:

- momentum_12_1     return from t-12m to t-1m (skip the most recent month) — winners run
- low_volatility    −(trailing annualised vol) — the low-vol anomaly
- near_52w_high     close / trailing-252d high — proximity-to-high momentum
- short_term_reversal  −(trailing 21d return) — 1-month losers bounce

Higher factor value = better rank (we negate vol / reversal so "higher is better"
holds uniformly). Names without enough history for the factor are ineligible that bar.
"""

from __future__ import annotations

import math
from datetime import date

_TRADING_DAYS = 252
_MONTH = 21


def _ann_vol(closes: list[float]) -> float:
    if len(closes) < 3:
        return 0.0
    rets = [closes[i] / closes[i - 1] - 1.0 for i in range(1, len(closes)) if closes[i - 1] > 0]
    if len(rets) < 2:
        return 0.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(_TRADING_DAYS)


def factor_value(closes: list[float], end: int, factor: str, lookback: int) -> float | None:
    """Factor measured from closes[:end] (data available BEFORE bar `end`). None if
    insufficient history. Higher = better rank for every factor."""
    if end <= 0:
        return None
    hist = closes[:end]                       # strictly before bar `end`
    n = len(hist)
    last = hist[-1]
    if factor == "momentum_12_1":
        if n < lookback + 1:
            return None
        old = hist[-lookback]                 # ~12m ago
        recent = hist[-_MONTH - 1]            # ~1m ago (skip the last month)
        return (recent / old - 1.0) if old > 0 else None
    if factor == "low_volatility":
        if n < lookback:
            return None
        return -_ann_vol(hist[-lookback:])
    if factor == "near_52w_high":
        if n < lookback:
            return None
        hi = max(hist[-lookback:])
        return (last / hi) if hi > 0 else None
    if factor == "short_term_reversal":
        if n < _MONTH + 1:
            return None
        old = hist[-_MONTH - 1]
        return -(last / old - 1.0) if old > 0 else None
    return None


def build_membership(
    *,
    dates: list[date],
    closes_by_name: dict[str, list[float]],
    factor: str,
    top_n: int,
    lookback_days: int,
) -> tuple[dict[str, list[bool]], dict[str, float], dict[str, float | None], dict[str, int | None]]:
    """For every bar, rank eligible names by `factor` and mark the top-N as in-market.

    Returns (in_market_by_name, score_by_name, latest_factor_value, latest_rank).
    score_by_name is the most-recent cross-sectional rank percentile (1.0 = best),
    used only when the book is weighted signal-proportionally downstream.
    """
    names = list(closes_by_name.keys())
    n_days = len(dates)
    in_market = {t: [False] * n_days for t in names}
    latest_val: dict[str, float | None] = {t: None for t in names}
    latest_rank: dict[str, int | None] = {t: None for t in names}

    for i in range(n_days):
        vals = {t: factor_value(closes_by_name[t], i, factor, lookback_days) for t in names}
        eligible = [(t, v) for t, v in vals.items() if v is not None]
        eligible.sort(key=lambda kv: kv[1], reverse=True)       # higher factor = better
        chosen = {t for t, _ in eligible[:max(1, top_n)]}
        for t in chosen:
            in_market[t][i] = True
        if i == n_days - 1:
            latest_val = dict(vals)
            for rank, (t, _) in enumerate(eligible, start=1):
                latest_rank[t] = rank

    # signal score = latest rank percentile (best = 1.0); ineligible → 0.5 neutral
    ranked = [t for t in names if latest_rank[t] is not None]
    m = len(ranked)
    score = {t: 0.5 for t in names}
    for t in ranked:
        score[t] = round(1.0 - (latest_rank[t] - 1) / max(1, m - 1), 4) if m > 1 else 1.0
    return in_market, score, latest_val, latest_rank


def asof_factor_readings(closes_by_name: dict[str, list[float]]) -> dict[str, float | str]:
    """Factor-agnostic as-of universe stats the LLM sees before picking ONE factor:
    dispersion of 12-1 momentum, trailing vol, and proximity-to-high across names."""
    moms, vols, prox, rev = [], [], [], []
    for closes in closes_by_name.values():
        n = len(closes)
        mv = factor_value(closes, n, "momentum_12_1", _TRADING_DAYS)
        if mv is not None:
            moms.append(mv * 100.0)
        vv = factor_value(closes, n, "low_volatility", 63)
        if vv is not None:
            vols.append(-vv * 100.0)
        pv = factor_value(closes, n, "near_52w_high", _TRADING_DAYS)
        if pv is not None:
            prox.append(pv * 100.0)
        rv = factor_value(closes, n, "short_term_reversal", _MONTH)
        if rv is not None:
            rev.append(-rv * 100.0)

    def _spread(xs):
        return (round(min(xs), 1), round(sum(xs) / len(xs), 1), round(max(xs), 1)) if xs else (0.0, 0.0, 0.0)

    mom_lo, mom_mid, mom_hi = _spread(moms)
    vol_lo, vol_mid, vol_hi = _spread(vols)
    prox_lo, prox_mid, prox_hi = _spread(prox)
    rev_lo, rev_mid, rev_hi = _spread(rev)
    return {
        "n_names": float(len(closes_by_name)),
        "momentum_12_1_pct_min_mean_max": f"{mom_lo} / {mom_mid} / {mom_hi}",
        "ann_vol_pct_min_mean_max": f"{vol_lo} / {vol_mid} / {vol_hi}",
        "pct_of_52w_high_min_mean_max": f"{prox_lo} / {prox_mid} / {prox_hi}",
        "reversal_1m_ret_pct_min_mean_max": f"{rev_lo} / {rev_mid} / {rev_hi}",
        "momentum_dispersion_pct": round(mom_hi - mom_lo, 1),
        "vol_dispersion_pct": round(vol_hi - vol_lo, 1),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["n_names", "momentum_12_1_pct_min_mean_max", "ann_vol_pct_min_mean_max",
             "pct_of_52w_high_min_mean_max", "reversal_1m_ret_pct_min_mean_max",
             "momentum_dispersion_pct", "vol_dispersion_pct"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)
