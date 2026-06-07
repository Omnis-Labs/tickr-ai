"""Position-sizing math. Pure, deterministic.

Given the set of names that are long at a rebalance and their trailing returns,
produce target weights under the chosen method, then apply the single-name cap,
gross cap, and (optional) portfolio vol target. All inputs are trailing (computed
from returns up to the rebalance date), so sizing never peeks ahead.
"""

from __future__ import annotations

import math

_TRADING_DAYS = 252


def annualised_vol(returns: list[float]) -> float:
    """Annualised stdev of daily returns. 0 if too few points."""
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(var) * math.sqrt(_TRADING_DAYS)


def covariance(rets_a: list[float], rets_b: list[float]) -> float:
    n = min(len(rets_a), len(rets_b))
    if n < 2:
        return 0.0
    a, b = rets_a[-n:], rets_b[-n:]
    ma, mb = sum(a) / n, sum(b) / n
    return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / (n - 1) * _TRADING_DAYS


def _normalise(w: list[float]) -> list[float]:
    s = sum(w)
    return [x / s for x in w] if s > 1e-12 else [1.0 / len(w)] * len(w) if w else []


def equal_weights(n: int) -> list[float]:
    return [1.0 / n] * n if n else []


def inverse_vol_weights(vols: list[float]) -> list[float]:
    inv = [1.0 / v if v > 1e-9 else 0.0 for v in vols]
    if sum(inv) <= 1e-12:
        return equal_weights(len(vols))
    return _normalise(inv)


def signal_proportional_weights(scores: list[float]) -> list[float]:
    pos = [max(0.0, s) for s in scores]
    if sum(pos) <= 1e-12:
        return equal_weights(len(scores))
    return _normalise(pos)


def risk_parity_weights(cov: list[list[float]], iters: int = 100) -> list[float]:
    """Equal-risk-contribution weights via the standard iterative scheme.

    Each name should contribute equal risk: w_i·(Σw)_i = constant. Falls back to
    inverse-vol if the covariance is degenerate. Reduces to inverse-vol when names
    are uncorrelated, but genuinely differs once correlations bite.
    """
    n = len(cov)
    if n == 0:
        return []
    if n == 1:
        return [1.0]
    vols = [math.sqrt(cov[i][i]) if cov[i][i] > 0 else 0.0 for i in range(n)]
    w = inverse_vol_weights(vols)
    for _ in range(iters):
        mrc = [sum(cov[i][j] * w[j] for j in range(n)) for i in range(n)]  # marginal risk
        port_var = sum(w[i] * mrc[i] for i in range(n))
        if port_var <= 1e-18:
            return inverse_vol_weights(vols)
        target = port_var / n
        new = [w[i] * target / (w[i] * mrc[i] if w[i] * mrc[i] > 1e-18 else 1e-18) for i in range(n)]
        w = _normalise(new)
    return w


def apply_max_weight(w: list[float], cap: float) -> list[float]:
    """Clip any weight above `cap` and redistribute the excess to uncapped names,
    iterating until no weight exceeds the cap (or it's infeasible)."""
    n = len(w)
    if n == 0 or cap <= 0:
        return w
    if cap * n <= 1.0 + 1e-9:           # cap too tight to sum to 1 → equal weight at cap
        return [1.0 / n] * n
    w = list(w)
    for _ in range(2 * n + 2):
        over = [i for i in range(n) if w[i] > cap + 1e-12]
        if not over:
            break
        excess = sum(w[i] - cap for i in over)
        for i in over:
            w[i] = cap
        # redistribute ONLY to names with room (strictly under the cap) — never
        # back onto already-capped names, or they creep above the cap again.
        free = [i for i in range(n) if w[i] < cap - 1e-12]
        free_sum = sum(w[i] for i in free)
        if not free or free_sum <= 1e-12:
            break
        for i in free:
            w[i] += excess * w[i] / free_sum
    return w


def scale_gross_and_vol(
    w: list[float], cov: list[list[float]], *, gross_cap: float, target_vol_pct: float,
) -> tuple[list[float], float]:
    """Scale the whole book by a single leverage factor in [0, gross_cap] (long-only,
    so vol-targeting only *de-risks*). Returns (scaled weights, applied gross)."""
    gross = min(1.0, max(0.0, gross_cap))
    if target_vol_pct and target_vol_pct > 0 and w:
        n = len(w)
        port_var = sum(w[i] * sum(cov[i][j] * w[j] for j in range(n)) for i in range(n))
        port_vol = math.sqrt(port_var) * 100.0 if port_var > 0 else 0.0
        if port_vol > target_vol_pct and port_vol > 1e-9:
            gross = min(gross, target_vol_pct / port_vol)
    return [x * gross for x in w], gross


def target_weights(
    *, method: str, vols: list[float], cov: list[list[float]], scores: list[float],
    max_weight: float, gross_cap: float, target_vol_pct: float,
) -> tuple[list[float], float]:
    """Dispatch to a sizing method, then apply the single-name cap + gross/vol scaling.
    Returns (weights summing to <= gross, applied gross)."""
    n = len(vols)
    if n == 0:
        return [], 0.0
    if method == "equal_weight":
        raw = equal_weights(n)
    elif method == "inverse_vol":
        raw = inverse_vol_weights(vols)
    elif method == "risk_parity":
        raw = risk_parity_weights(cov)
    elif method == "signal_proportional":
        raw = signal_proportional_weights(scores)
    else:
        raw = equal_weights(n)
    capped = apply_max_weight(raw, max_weight)
    return scale_gross_and_vol(capped, cov, gross_cap=gross_cap, target_vol_pct=target_vol_pct)
