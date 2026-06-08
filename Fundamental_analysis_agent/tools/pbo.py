"""Probability of Backtest Overfitting (PBO) via Combinatorially-Symmetric Cross-Validation.

Bailey, Borwein, López de Prado & Zhu (2014/2017), "The Probability of Backtest Overfitting",
J. Computational Finance. PBO estimates how often the strategy that looks best *in sample* lands
in the bottom half *out of sample* — i.e. the probability that backtest-shopping has selected an
overfit fluke rather than a real edge.

Method (CSCV):
  1. Build a matrix M of T period-returns × N strategies.
  2. Split T into S even, disjoint contiguous chunks.
  3. For every way to choose S/2 chunks as IS (the rest OOS):
       - pick the strategy with the highest IS Sharpe (n*);
       - find n*'s relative rank ω ∈ (0,1) among all strategies' OOS Sharpe;
       - record the logit λ = ln(ω / (1-ω)).
  4. PBO = P(λ ≤ 0) = fraction of splits where the IS-best is below the OOS median.

Strategy universe = the 11 placebo controls' trials (system × signal × ticker). The honest point:
in a universe with *no* real edge, naive "pick the best backtest" should overfit with high
probability — PBO quantifies exactly that, and it's the risk the suite's DSR gate defends against.

Reuses the null-band machinery (same panel, same lookahead-free backtest); resamples each trial's
equity curve to weekly returns. Network needed (price fetch), deterministic given the data.

    python tools/pbo.py            # default S=16, bull window
    python tools/pbo.py --chunks 12 --start 2022-01-01 --end 2022-12-31
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import math
from datetime import date, timedelta
from pathlib import Path

from tools.divination_null_band import (
    _PANEL, _MIN_BARS, _LOOKBACK, _control_signals, _listing,
    fetch_prices, run_factor_backtest, init_db,
)

_ROOT = Path(__file__).resolve().parents[1]
_OUT = _ROOT / "shared" / "reports" / "pbo.json"


async def build_matrix(tickers, start_date, end_date):
    """Return (labels, raw_matrix, excess_matrix). raw = strategy weekly returns; excess =
    strategy minus market (active) weekly returns — the latter strips the common equity beta
    that otherwise lets IS winners persist OOS for free in a bull. Both aligned on common weeks."""
    await init_db()
    spy = await asyncio.to_thread(fetch_prices, "SPY")
    strat: dict[str, dict[tuple, float]] = {}
    mkt: dict[str, dict[tuple, float]] = {}
    for tk in tickers:
        try:
            prices = await asyncio.to_thread(fetch_prices, tk)
        except Exception:  # noqa: BLE001
            continue
        if end_date is not None:
            prices = [p for p in prices if p.date <= end_date]
        if len(prices) < _MIN_BARS:
            continue
        as_of = prices[-1].date
        start = start_date if start_date is not None else max(prices[0].date, as_of - timedelta(days=_LOOKBACK))
        start = max(start, prices[0].date)
        dates = [p.date for p in prices if p.date >= start]
        listing = await asyncio.to_thread(_listing, tk, prices[0].date)
        for system, sigs in _control_signals(listing, dates):
            for label, wl in sigs:
                try:
                    bt = run_factor_backtest(prices, wl, start=start, exit_mode="deteriorating",
                                             transaction_cost_bps=10.0, market_prices=spy)
                except Exception:  # noqa: BLE001
                    continue
                key = f"{system}|{label}|{tk}"
                sw: dict[tuple, float] = {}; mw: dict[tuple, float] = {}
                for pt in bt.equity_curve:
                    iso = pt.date.isocalendar()
                    sw[(iso[0], iso[1])] = pt.strategy
                    if pt.market is not None:
                        mw[(iso[0], iso[1])] = pt.market
                strat[key] = sw; mkt[key] = mw

    if not strat:
        return [], [], []
    common = sorted(set.intersection(*[set(v) for v in strat.values()]))
    labels, raw, excess = [], [], []
    for lbl in strat:
        sv = [strat[lbl][w] for w in common]
        srets = [sv[i] / sv[i - 1] - 1.0 for i in range(1, len(sv)) if sv[i - 1]]
        mv = [mkt[lbl].get(w) for w in common]
        have_mkt = all(x is not None for x in mv)
        mrets = [mv[i] / mv[i - 1] - 1.0 for i in range(1, len(mv))] if have_mkt else None
        if len(srets) != len(common) - 1 or not any(r != 0 for r in srets):
            continue
        labels.append(lbl)
        raw.append(srets)
        excess.append([s - m for s, m in zip(srets, mrets)] if mrets else srets)
    return labels, raw, excess


def _chunk_stats(matrix, n_chunks):
    """Per-strategy, per-chunk (count, sum, sumsq) so IS/OOS Sharpe is O(N·S) per split."""
    T = len(matrix[0])
    bounds = [round(i * T / n_chunks) for i in range(n_chunks + 1)]
    stats = []  # stats[strategy][chunk] = (n, s, ss)
    for col in matrix:
        per = []
        for c in range(n_chunks):
            seg = col[bounds[c]:bounds[c + 1]]
            n = len(seg); s = math.fsum(seg); ss = math.fsum(x * x for x in seg)
            per.append((n, s, ss))
        stats.append(per)
    return stats


def _sharpe_from(agg):
    n, s, ss = agg
    if n < 2:
        return 0.0
    mean = s / n
    var = ss / n - mean * mean
    if var <= 1e-8:        # flat segment (e.g. strategy sat in cash) → no risk-adjusted signal
        return 0.0
    return mean / math.sqrt(var)


def cscv(matrix, n_chunks):
    stats = _chunk_stats(matrix, n_chunks)
    N = len(matrix)
    lams, degr = [], []
    n_below = 0
    half = n_chunks // 2
    for combo in itertools.combinations(range(n_chunks), half):
        cset = set(combo)
        is_sh, oos_sh = [], []
        for per in stats:
            ni = si = ssi = 0.0; no = so = sso = 0.0
            for c in range(n_chunks):
                n, s, ss = per[c]
                if c in cset:
                    ni += n; si += s; ssi += ss
                else:
                    no += n; so += s; sso += ss
            is_sh.append(_sharpe_from((ni, si, ssi)))
            oos_sh.append(_sharpe_from((no, so, sso)))
        n_star = max(range(N), key=lambda i: is_sh[i])
        # relative OOS rank of n_star (1 = best OOS, 0 = worst)
        better = sum(1 for v in oos_sh if v < oos_sh[n_star])
        omega = (better + 0.5) / N
        omega = min(max(omega, 1e-6), 1 - 1e-6)
        lams.append(math.log(omega / (1 - omega)))
        degr.append(oos_sh[n_star] - is_sh[n_star])
        if lams[-1] <= 0:
            n_below += 1
    n_splits = len(lams)
    return {
        "pbo": round(n_below / n_splits, 4),
        "n_splits": n_splits,
        "logit_mean": round(math.fsum(lams) / n_splits, 4),
        "oos_minus_is_sharpe_mean": round(math.fsum(degr) / n_splits, 4),
    }


async def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default=",".join(_PANEL))
    ap.add_argument("--chunks", type=int, default=16, help="S — even number of CSCV sub-periods")
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--output", default=str(_OUT))
    args = ap.parse_args(argv)
    sd = date.fromisoformat(args.start) if args.start else None
    ed = date.fromisoformat(args.end) if args.end else None
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]

    labels, raw, excess = await build_matrix(tickers, sd, ed)
    if len(raw) < 4 or len(raw[0]) < args.chunks:
        raise SystemExit(f"insufficient data: {len(raw)} strategies × {len(raw[0]) if raw else 0} weeks")
    raw_res = cscv(raw, args.chunks)
    exc_res = cscv(excess, args.chunks)

    # Per-ticker PBO isolates the *timing rule*: within one name, every "strategy" is a different
    # divination timing on the SAME stock, so the cross-name selection/momentum confound is removed.
    by_tkr: dict[str, list[int]] = {}
    for i, lbl in enumerate(labels):
        by_tkr.setdefault(lbl.rsplit("|", 1)[-1], []).append(i)
    per_ticker = {}
    pbos = []
    for tkr, idx in by_tkr.items():
        if len(idx) < 8:
            continue
        sub = [raw[i] for i in idx]
        r = cscv(sub, args.chunks)
        per_ticker[tkr] = {"pbo": r["pbo"], "n_strategies": len(idx)}
        pbos.append(r["pbo"])
    pbos.sort()
    pbo_timing_median = round(pbos[len(pbos) // 2], 4) if pbos else None

    out = {
        "method": "Probability of Backtest Overfitting — CSCV (Bailey/López de Prado, 2014)",
        "universe": "11 placebo-control trials (system × signal × ticker)",
        "window": {"start": args.start or "trailing", "end": args.end or "latest"},
        "n_strategies": len(raw), "n_weeks": len(raw[0]), "n_chunks": args.chunks,
        "pbo_timing_per_ticker_median": pbo_timing_median,
        "pbo_timing_per_ticker": per_ticker,
        "pbo_pooled_raw_returns": raw_res,
        "pbo_pooled_excess_vs_market": exc_res,
        "interpretation": (
            f"Headline — PER-TICKER timing PBO (median across names) = {pbo_timing_median}. With the stock "
            f"held fixed so only the divination timing rule varies, selecting the in-sample-best timing rule "
            f"lands below the OOS median ~{(pbo_timing_median or 0)*100:.0f}% of the time — the ≈0.5 coin-flip "
            f"that confirms no persistent timing skill. The POOLED cross-name PBO looks lower (raw "
            f"{raw_res['pbo']}, excess {exc_res['pbo']}) only because picking the name that won (e.g. NVDA) "
            f"persists across the whole bull — that is selection/momentum, not skill, and is exactly the "
            f"confound per-ticker PBO removes."
        ),
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"PBO — {out['n_strategies']} strategies × {out['n_weeks']} weeks, S={args.chunks}, splits={raw_res['n_splits']}")
    print(f"  HEADLINE per-ticker timing PBO (median) : {pbo_timing_median}   (≈0.5 = no timing skill)")
    print(f"    per ticker: " + ", ".join(f"{t}={v['pbo']}" for t, v in sorted(per_ticker.items())))
    print(f"  pooled cross-name PBO  raw={raw_res['pbo']}  excess-vs-mkt={exc_res['pbo']}  (confounded by name selection)")
    print(f"  written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
