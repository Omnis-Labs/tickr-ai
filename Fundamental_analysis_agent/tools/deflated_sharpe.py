"""Deflated Sharpe Ratio (DSR) + Probabilistic Sharpe Ratio (PSR) over the placebo trial set.

This is the *citable* upgrade of the home-grown "divination null band". Instead of an ad-hoc
p95 of the pooled control Sharpes, we use the closed forms from:

  • Bailey & López de Prado (2014), "The Sharpe Ratio Efficient Frontier", J. Risk —
    Probabilistic Sharpe Ratio (PSR): P(true SR > benchmark) given track length + non-normality.
  • Bailey & López de Prado (2014), "The Deflated Sharpe Ratio: Correcting for Selection Bias,
    Backtest Overfitting and Non-Normality", J. Portfolio Management 40(5) —
    the Deflated Sharpe Ratio (DSR) = PSR evaluated against the *expected maximum* Sharpe that
    N independent trials would produce by luck alone.

The placebo controls (11 worthless divination systems) ARE our trial set: their pooled per-trial
Sharpes give the variance V[SR] across strategies, and N = the number of trials we ran. From those
two numbers the López de Prado approximation tells us the Sharpe a *lucky* strategy reaches given
that many attempts — the honest bar a real agent must clear. We then report each real agent's DSR:
the probability its Sharpe reflects skill rather than the best of N coin-flips.

Pure post-processor: reads shared/reports/divination_null_band.json (run tools/divination_null_band.py
first). No network, deterministic, fast.

Usage:
    python tools/deflated_sharpe.py
    python tools/deflated_sharpe.py --freq 252 --skew 0 --kurt 3
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from statistics import NormalDist

_ROOT = Path(__file__).resolve().parents[1]
_IN = _ROOT / "shared" / "reports" / "divination_null_band.json"
_OUT = _ROOT / "shared" / "reports" / "deflated_sharpe.json"

_EULER = 0.5772156649015329          # Euler–Mascheroni γ
_N = NormalDist()


def expected_max_sharpe(n_trials: int, var_sr: float) -> float:
    """E[max SR] over N independent trials whose per-trial Sharpe has variance var_sr.
    Bailey & López de Prado (2014), eq. for the expected maximum of N Gaussians:
        E[max] ≈ √V · [ (1-γ)·Z⁻¹(1 - 1/N) + γ·Z⁻¹(1 - 1/(N·e)) ]
    All quantities in the SAME (here per-period) Sharpe units as var_sr."""
    if n_trials < 2 or var_sr <= 0:
        return 0.0
    sd = math.sqrt(var_sr)
    z1 = _N.inv_cdf(1.0 - 1.0 / n_trials)
    z2 = _N.inv_cdf(1.0 - 1.0 / (n_trials * math.e))
    return sd * ((1.0 - _EULER) * z1 + _EULER * z2)


def psr(sr: float, benchmark: float, n_obs: int, skew: float, kurt: float) -> float:
    """Probabilistic Sharpe Ratio: P(true SR > benchmark). All Sharpes in per-period units.
    Bailey & López de Prado (2014):
        PSR = Φ( (SR - SR*)·√(n-1) / √(1 - skew·SR + ((kurt-1)/4)·SR²) )"""
    if n_obs < 2:
        return float("nan")
    denom = math.sqrt(max(1e-12, 1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr))
    return _N.cdf((sr - benchmark) * math.sqrt(n_obs - 1) / denom)


def analyse(rep: dict, freq: float, skew: float, kurt: float) -> dict:
    samples_ann = rep.get("pooled_sharpe_samples") or rep.get("_pooled") or []
    n_bars = rep.get("n_bars_median") or 756
    if len(samples_ann) < 2:
        raise SystemExit("no pooled_sharpe_samples in report — re-run tools/divination_null_band.py")

    rt = math.sqrt(freq)
    # work in per-period Sharpe units (reported Sharpes are annualised)
    samples = [s / rt for s in samples_ann]
    n_trials = len(samples)
    var_sr = statistics.pvariance(samples)
    emax = expected_max_sharpe(n_trials, var_sr)             # per-period
    emax_ann = emax * rt

    # the null trial set is, by construction, skill-less: its own best should NOT clear DSR.
    sr_max_ann = max(samples_ann)

    overlay = rep.get("real_agent_overlay", {})
    agents = []
    for name, o in overlay.items():
        sr_ann = o.get("sharpe_median")
        if not isinstance(sr_ann, (int, float)):
            continue
        sr = sr_ann / rt
        agents.append({
            "agent": name,
            "sharpe_ann": round(sr_ann, 3),
            "psr_vs_zero": round(psr(sr, 0.0, n_bars, skew, kurt), 4),         # is SR>0 credible at all?
            "dsr": round(psr(sr, emax, n_bars, skew, kurt), 4),               # beats best-of-N luck?
            "beats_expected_max": sr_ann > emax_ann,
            "significant_dsr_0_95": psr(sr, emax, n_bars, skew, kurt) > 0.95,
        })
    agents.sort(key=lambda a: -a["dsr"])

    return {
        "method": "Deflated Sharpe Ratio (Bailey & López de Prado, 2014)",
        "inputs": {
            "n_trials": n_trials, "n_bars_median": n_bars, "freq_per_year": freq,
            "skew_assumed": skew, "kurt_assumed": kurt,
            "var_sr_ann": round(var_sr * freq, 4),
        },
        "expected_max_sharpe_ann": round(emax_ann, 3),
        "control_max_sharpe_ann": round(sr_max_ann, 3),
        "legacy_p95_threshold_ann": rep.get("sharpe_p95_threshold"),
        "n_agents_significant": sum(1 for a in agents if a["significant_dsr_0_95"]),
        "agents": agents,
        "interpretation": (
            f"Across {n_trials} skill-less placebo trials the expected best Sharpe by luck alone is "
            f"{emax_ann:.2f} (annualised). A real agent's edge is credible only if its Deflated Sharpe "
            f"Ratio > 0.95 — i.e. it beats not the median fluke but the best-of-{n_trials} fluke. "
            f"{sum(1 for a in agents if a['significant_dsr_0_95'])}/{len(agents)} agents clear it on median single-name Sharpe."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(_IN))
    ap.add_argument("--output", default=str(_OUT))
    ap.add_argument("--freq", type=float, default=252.0, help="return periods per year (daily=252)")
    ap.add_argument("--skew", type=float, default=0.0, help="assumed return skew (0 = Gaussian)")
    ap.add_argument("--kurt", type=float, default=3.0, help="assumed return kurtosis (3 = Gaussian)")
    args = ap.parse_args(argv)

    rep = json.loads(Path(args.input).read_text())
    out = analyse(rep, args.freq, args.skew, args.kurt)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False))

    i = out["inputs"]
    print(f"Deflated Sharpe Ratio — {i['n_trials']} placebo trials, n={i['n_bars_median']} bars, freq={i['freq_per_year']:.0f}")
    print(f"  V[SR] (ann)              : {i['var_sr_ann']}")
    print(f"  E[max SR] by luck (ann)  : {out['expected_max_sharpe_ann']}   <- the honest bar")
    print(f"  control max SR (ann)     : {out['control_max_sharpe_ann']}   (placebo best — should NOT clear)")
    print(f"  legacy p95 threshold     : {out['legacy_p95_threshold_ann']}")
    print(f"  {'agent':16}{'SR_ann':>8}{'PSR>0':>8}{'DSR':>8}{'sig?':>6}")
    for a in out["agents"]:
        print(f"  {a['agent']:16}{a['sharpe_ann']:8.2f}{a['psr_vs_zero']:8.2f}{a['dsr']:8.2f}{('YES' if a['significant_dsr_0_95'] else '-'):>6}")
    print(f"  => {out['n_agents_significant']}/{len(out['agents'])} significant (DSR>0.95)")
    print(f"  written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
