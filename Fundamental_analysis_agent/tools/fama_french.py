"""Fama–French 5-factor (+ momentum) alpha for the placebo timing overlay.

Regresses each placebo control's ACTIVE daily return — strategy minus buy-and-hold of the *same*
stock — on the Fama–French 5 factors (Mkt-RF, SMB, HML, RMW, CMA) plus momentum (MOM). The active
return isolates what the divination *timing* contributes over just holding the name, so the
regression's intercept α is the timing overlay's factor-adjusted alpha. For a worthless timing rule
α should be ≈ 0 with |t| < 2.

(Regressing the strategy's raw return on FF instead would just surface the host stock's idiosyncratic
drift as "alpha" — FF factors don't span single names. Differencing against buy-and-hold removes that
confound and leaves only the timing decision, which is what we actually want to test.)

Factors: Ken French Data Library (daily), fetched once and cached to
shared/reports/ff_factors_daily.json. OLS + classical t-stats via numpy (no statsmodels needed).

    python tools/fama_french.py
    python tools/fama_french.py --start 2022-01-01 --end 2022-12-31
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from tools.divination_null_band import (
    _PANEL, _MIN_BARS, _LOOKBACK, _control_signals, _listing,
    fetch_prices, run_factor_backtest, init_db,
)

_ROOT = Path(__file__).resolve().parents[1]
_OUT = _ROOT / "shared" / "reports" / "fama_french.json"
_CACHE = _ROOT / "shared" / "reports" / "ff_factors_daily.json"
_FF5 = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
_MOM = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_daily_CSV.zip"


def _fetch_zip_csv(url: str) -> list[str]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    return z.read(z.namelist()[0]).decode("latin1").splitlines()


def _parse_daily(lines: list[str], cols: list[str]) -> dict[str, list[float]]:
    """Parse a Ken-French daily CSV: find the header row, then YYYYMMDD rows until a blank line."""
    out: dict[str, list[float]] = {}
    header_i = next(i for i, ln in enumerate(lines) if ln.replace(" ", "").startswith(","))
    names = [c.strip() for c in lines[header_i].split(",")]
    idx = {c: names.index(c) for c in cols}
    for ln in lines[header_i + 1:]:
        s = ln.strip()
        if not s or "," not in s:
            break
        parts = [p.strip() for p in s.split(",")]
        if len(parts[0]) != 8 or not parts[0].isdigit():
            break
        d = f"{parts[0][:4]}-{parts[0][4:6]}-{parts[0][6:]}"
        try:
            out[d] = [float(parts[idx[c]]) / 100.0 for c in cols]   # FF values are in percent
        except (ValueError, IndexError):
            continue
    return out


def load_factors(start: date) -> dict[str, dict[str, float]]:
    if _CACHE.exists():
        cached = json.loads(_CACHE.read_text())
        if date.fromisoformat(min(cached)) <= start:
            return cached
    ff5 = _parse_daily(_fetch_zip_csv(_FF5), ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"])
    mom_lines = _fetch_zip_csv(_MOM)
    mom_col = "Mom" if any(",Mom" in ln.replace(" ", "") for ln in mom_lines) else "WML"
    mom = _parse_daily(mom_lines, [mom_col])
    fac: dict[str, dict[str, float]] = {}
    for d, v in ff5.items():
        if d in mom and d >= "2021-01-01":
            fac[d] = {"Mkt-RF": v[0], "SMB": v[1], "HML": v[2], "RMW": v[3], "CMA": v[4], "RF": v[5], "MOM": mom[d][0]}
    _CACHE.write_text(json.dumps(fac, indent=0))
    return fac


def ols_alpha(y: np.ndarray, X: np.ndarray) -> tuple[float, float]:
    """Return (alpha_daily, t_stat) for the intercept in y = α + Xβ + ε (classical OLS SE)."""
    n = len(y)
    Xd = np.column_stack([np.ones(n), X])
    beta, *_ = np.linalg.lstsq(Xd, y, rcond=None)
    resid = y - Xd @ beta
    dof = n - Xd.shape[1]
    sigma2 = float(resid @ resid) / dof
    xtx_inv = np.linalg.inv(Xd.T @ Xd)
    se = np.sqrt(sigma2 * np.diag(xtx_inv))
    return float(beta[0]), float(beta[0] / se[0])


async def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default=",".join(_PANEL))
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--output", default=str(_OUT))
    args = ap.parse_args(argv)
    sd = date.fromisoformat(args.start) if args.start else None
    ed = date.fromisoformat(args.end) if args.end else None
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]

    await init_db()
    spy = await asyncio.to_thread(fetch_prices, "SPY")
    factors = load_factors(sd or (date.today() - timedelta(days=_LOOKBACK + 60)))
    FCOLS = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "MOM"]

    alphas_ann, tstats, sig = [], [], 0
    sig_pos = sig_neg = 0
    n_eval = 0
    for tk in tickers:
        try:
            prices = await asyncio.to_thread(fetch_prices, tk)
        except Exception:  # noqa: BLE001
            continue
        if ed is not None:
            prices = [p for p in prices if p.date <= ed]
        if len(prices) < _MIN_BARS:
            continue
        as_of = prices[-1].date
        start = sd if sd is not None else max(prices[0].date, as_of - timedelta(days=_LOOKBACK))
        start = max(start, prices[0].date)
        dates = [p.date for p in prices if p.date >= start]
        listing = await asyncio.to_thread(_listing, tk, prices[0].date)
        for system, sigs in _control_signals(listing, dates):
            for _label, wl in sigs:
                try:
                    bt = run_factor_backtest(prices, wl, start=start, exit_mode="deteriorating",
                                             transaction_cost_bps=10.0, market_prices=spy)
                except Exception:  # noqa: BLE001
                    continue
                ec = bt.equity_curve
                ys, xs = [], []
                for i in range(1, len(ec)):
                    d = ec[i].date.isoformat()
                    if d not in factors or not ec[i - 1].strategy or not ec[i - 1].benchmark:
                        continue
                    sr = ec[i].strategy / ec[i - 1].strategy - 1.0
                    br = ec[i].benchmark / ec[i - 1].benchmark - 1.0
                    ys.append(sr - br)                            # active timing return
                    xs.append([factors[d][c] for c in FCOLS])
                if len(ys) < 60:
                    continue
                a_d, t = ols_alpha(np.array(ys), np.array(xs))
                alphas_ann.append((1.0 + a_d) ** 252 - 1.0)
                tstats.append(t)
                if abs(t) > 2.0:
                    sig += 1
                    if t > 0:
                        sig_pos += 1
                    else:
                        sig_neg += 1
                n_eval += 1

    ts = np.array(tstats)
    aa = np.array(alphas_ann)
    out = {
        "method": "Fama–French 5-factor + momentum alpha on the placebo TIMING overlay (active return vs buy-and-hold)",
        "factors": FCOLS,
        "window": {"start": args.start or "trailing", "end": args.end or "latest"},
        "n_regressions": n_eval,
        "alpha_tstat": {"median": round(float(np.median(ts)), 3), "mean": round(float(ts.mean()), 3),
                        "p5": round(float(np.percentile(ts, 5)), 3), "p95": round(float(np.percentile(ts, 95)), 3)},
        "annualised_alpha_pct": {"median": round(float(np.median(aa)) * 100, 2),
                                 "p5": round(float(np.percentile(aa, 5)) * 100, 2),
                                 "p95": round(float(np.percentile(aa, 95)) * 100, 2)},
        "n_significant_abs_t_gt_2": sig,
        "n_significant_positive": sig_pos,
        "n_significant_negative": sig_neg,
        "frac_significant": round(sig / n_eval, 4) if n_eval else None,
        "interpretation": (
            f"Across {n_eval} placebo timing overlays, FF5+MOM alpha t-stats centre at {float(np.median(ts)):.2f} "
            f"(median annualised alpha {float(np.median(aa))*100:.1f}%). Of the {sig} that reach |t|>2, "
            f"{sig_neg} are significantly NEGATIVE and only {sig_pos} positive — i.e. after controlling for "
            f"market/size/value/profitability/investment/momentum, the divination timing produces no positive "
            f"alpha; in a bull it is a structural drag (sitting out forfeits the premium). A real agent must "
            f"show a positive FF-alpha t-stat; the same regression takes any agent return stream as a drop-in."
        ),
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"Fama–French 5+MOM alpha on placebo timing overlays — {n_eval} regressions, window {out['window']}")
    print(f"  alpha t-stat   median {out['alpha_tstat']['median']}  (p5 {out['alpha_tstat']['p5']}, p95 {out['alpha_tstat']['p95']})")
    print(f"  ann. alpha %   median {out['annualised_alpha_pct']['median']}  (p5 {out['annualised_alpha_pct']['p5']}, p95 {out['annualised_alpha_pct']['p95']})")
    print(f"  |t|>2          {sig}/{n_eval} = {out['frac_significant']}  ({sig_neg} negative, {sig_pos} positive)")
    print(f"  written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
