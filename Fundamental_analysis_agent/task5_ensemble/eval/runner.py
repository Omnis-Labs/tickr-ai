"""Task 5 eval runner — same shape as Task 2's, fields specific to the ensemble.

Pass/fail rides on what is deterministic (system invariants + deterministic
behaviour + cost/time caps); the stochastic arbiter choice is recorded, not
graded. See eval_set.yaml for the rationale.

Usage:
    python -m task5_ensemble.eval.runner
    python -m task5_ensemble.eval.runner --filter aapl
    python -m task5_ensemble.eval.runner --concurrency 2
    python -m task5_ensemble.eval.runner --baseline task5_ensemble/eval/report.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any

import yaml

from shared.cost_ledger import init_db
from shared.logging import configure_logging, get_logger

from task5_ensemble.pipeline.orchestrator import new_job_id, run_ensemble_pipeline
from task5_ensemble.schemas import EnsembleResult

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
logger = get_logger(__name__)


@dataclass
class CaseOutcome:
    id: str
    category: str
    ticker: str
    passed: bool
    status: str
    # recorded (soft) outcomes — surfaced for inspection, not graded
    fundamental_available: bool | None = None
    combine_mode: str | None = None
    agreement: str | None = None
    resolved_stance: str | None = None
    fundamental_stance: str | None = None
    technical_stance: str | None = None
    ensemble_return_pct: float | None = None
    ensemble_alpha_pct: float | None = None
    fundamental_return_pct: float | None = None
    technical_return_pct: float | None = None
    # Recorded, NOT graded: |ensemble − deferred-leg| when combine_mode is a
    # defer_*. Exact (~0) only when the deferred strategy has no intrabar stop /
    # take-profit overlay; a daily-exposure ensemble cannot reproduce an intrabar
    # fill, so an active deferred leg drifts. See combine.py for the rationale.
    defer_drift_pct: float | None = None
    common_window_start: str | None = None
    n_episodes: int | None = None
    duration_ms: int = 0
    cost_usd: float = 0.0
    failure_reasons: list[str] = field(default_factory=list)


def _percentile(vals: list[float], p: int) -> float:
    if not vals:
        return 0.0
    vs = sorted(vals)
    k = (len(vs) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(vs) - 1)
    if f == c:
        return float(vs[f])
    return float(vs[f] + (vs[c] - vs[f]) * (k - f))


def _check_invariants(r: EnsembleResult) -> list[str]:
    """System invariants asserted on EVERY successful case, regardless of config."""
    reasons: list[str] = []
    bt = r.backtest

    # ---- lookahead boundary ----
    if bt.start_date != r.common_window_start:
        reasons.append(
            f"backtest start {bt.start_date} != common_window_start {r.common_window_start}"
        )
    for t in bt.trades:
        if t.entry_date < r.common_window_start:
            reasons.append(f"episode opens {t.entry_date} before window start {r.common_window_start}")
            break
    if bt.equity_curve and abs(bt.equity_curve[0].benchmark - 1.0) > 1e-6:
        reasons.append(f"benchmark not anchored at 1.0 on bar 0 (got {bt.equity_curve[0].benchmark})")

    # ---- metrics populated + in range ----
    m = bt.metrics
    if not (0.0 <= m.exposure_pct <= 100.0):
        reasons.append(f"exposure_pct out of range: {m.exposure_pct}")
    if m.days <= 0:
        reasons.append(f"non-positive backtest days: {m.days}")
    return reasons


def _defer_drift(r: EnsembleResult) -> float | None:
    """|ensemble − deferred-leg| return. Recorded, not graded — exact only for a
    deferred leg with no intrabar risk overlay (see combine.py). The tight
    equality is pinned for the no-overlay case by the unit test
    test_defer_technical_reproduces_technical_backtest."""
    m = r.backtest.metrics
    if r.policy.combine_mode == "defer_technical" and r.technical.total_return_pct is not None:
        return round(abs(m.total_return_pct - r.technical.total_return_pct), 2)
    if r.policy.combine_mode == "defer_fundamental" and r.fundamental.total_return_pct is not None:
        return round(abs(m.total_return_pct - r.fundamental.total_return_pct), 2)
    return None


def _check(case: dict, result: EnsembleResult | None, error: Exception | None,
           duration_ms: int) -> tuple[bool, list[str]]:
    asserts = case.get("assertions", {})
    reasons: list[str] = []

    if asserts.get("expect_failed"):
        if error is None:
            return False, ["expected failure but pipeline completed"]
        max_dur = asserts.get("max_duration_ms")
        if max_dur is not None and duration_ms > max_dur:
            return False, [f"duration {duration_ms}ms > cap {max_dur}ms (even though it failed)"]
        return True, []

    if error is not None:
        return False, [f"crashed: {type(error).__name__}: {error}"]
    assert result is not None

    # ---- always-on system invariants ----
    reasons.extend(_check_invariants(result))

    # ---- deterministic per-case behaviour ----
    exp_avail = asserts.get("expect_fundamental_available")
    if exp_avail is not None and result.fundamental.available != exp_avail:
        reasons.append(
            f"fundamental_available={result.fundamental.available} expected {exp_avail}"
        )
    exp_mode = asserts.get("expect_combine_mode")
    if exp_mode is not None and result.policy.combine_mode != exp_mode:
        reasons.append(f"combine_mode={result.policy.combine_mode} expected {exp_mode}")
    allowed = asserts.get("allowed_combine_modes")
    if allowed is not None and result.policy.combine_mode not in allowed:
        reasons.append(f"combine_mode={result.policy.combine_mode} not in {allowed}")
    exp_agree = asserts.get("expect_agreement")
    if exp_agree is not None and result.policy.agreement != exp_agree:
        reasons.append(f"agreement={result.policy.agreement} expected {exp_agree}")

    # ---- cost / duration caps ----
    max_cost = asserts.get("max_cost_usd")
    if max_cost is not None and result.cost_usd > max_cost:
        reasons.append(f"cost ${result.cost_usd:.4f} > cap ${max_cost}")
    max_dur = asserts.get("max_duration_ms")
    if max_dur is not None and duration_ms > max_dur:
        reasons.append(f"duration {duration_ms}ms > cap {max_dur}ms")

    return (len(reasons) == 0), reasons


async def _run_case(case: dict[str, Any]) -> CaseOutcome:
    error: Exception | None = None
    result: EnsembleResult | None = None
    started = datetime.now(timezone.utc)
    try:
        result = await run_ensemble_pipeline(ticker=case["ticker"], job_id=new_job_id())
    except Exception as e:  # noqa: BLE001
        error = e
    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)

    passed, reasons = _check(case, result, error, duration_ms)
    o = CaseOutcome(
        id=case["id"],
        category=case.get("category", "uncategorized"),
        ticker=case["ticker"],
        passed=passed,
        status=("failed" if error is not None else "succeeded"),
        duration_ms=duration_ms,
        failure_reasons=reasons,
    )
    if result is not None:
        o.fundamental_available = result.fundamental.available
        o.combine_mode = result.policy.combine_mode
        o.agreement = result.policy.agreement
        o.resolved_stance = result.policy.resolved_stance
        o.fundamental_stance = result.fundamental.stance
        o.technical_stance = result.technical.stance
        o.ensemble_return_pct = result.backtest.metrics.total_return_pct
        o.ensemble_alpha_pct = result.backtest.metrics.excess_vs_market_pct
        o.fundamental_return_pct = result.fundamental.total_return_pct
        o.technical_return_pct = result.technical.total_return_pct
        o.defer_drift_pct = _defer_drift(result)
        o.common_window_start = result.common_window_start.isoformat()
        o.n_episodes = result.backtest.metrics.n_trades
        o.cost_usd = result.cost_usd
    return o


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="task5_ensemble/eval/report.json")
    parser.add_argument("--filter")
    parser.add_argument("--baseline")
    parser.add_argument(
        "--concurrency", type=int, default=2,
        help="Max simultaneous ensembles. Each runs 2 agents + arbiter + price "
        "fetches; keep low (2) so Yahoo/SEC don't rate-limit.",
    )
    args = parser.parse_args(argv)

    configure_logging()
    await init_db()

    spec = yaml.safe_load(EVAL_SET.read_text(encoding="utf-8"))
    cases = spec.get("cases", [])
    if args.filter:
        cases = [c for c in cases if args.filter in c["id"]]

    sem = asyncio.Semaphore(max(1, args.concurrency))

    async def _bounded(c: dict[str, Any]) -> CaseOutcome:
        async with sem:
            logger.info("eval_case_start", case_id=c["id"], ticker=c["ticker"])
            return await _run_case(c)

    outcomes: list[CaseOutcome] = await asyncio.gather(*(_bounded(c) for c in cases))

    n_pass = sum(1 for o in outcomes if o.passed)
    pass_rate = n_pass / max(1, len(outcomes))
    graded = [o for o in outcomes if o.status == "succeeded"]
    costs = [o.cost_usd for o in graded]
    durs = [float(o.duration_ms) for o in graded]

    # Distribution of recorded (soft) outcomes — the agree/conflict picture.
    by_category: dict[str, dict[str, Any]] = {}
    for o in outcomes:
        b = by_category.setdefault(o.category, {"n": 0, "n_pass": 0})
        b["n"] += 1
        b["n_pass"] += 1 if o.passed else 0
    agreement_dist: dict[str, int] = {}
    mode_dist: dict[str, int] = {}
    for o in graded:
        if o.agreement:
            agreement_dist[o.agreement] = agreement_dist.get(o.agreement, 0) + 1
        if o.combine_mode:
            mode_dist[o.combine_mode] = mode_dist.get(o.combine_mode, 0) + 1

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "n_cases": len(outcomes),
            "n_pass": n_pass,
            "pass_rate": pass_rate,
            "cost_p50": _percentile(costs, 50),
            "cost_p95": _percentile(costs, 95),
            "cost_total": sum(costs),
            "duration_p50_ms": _percentile(durs, 50),
            "duration_p95_ms": _percentile(durs, 95),
            "by_category": by_category,
            "agreement_distribution": agreement_dist,
            "combine_mode_distribution": mode_dist,
            # Recorded diagnostic: largest |ensemble − deferred-leg| drift seen.
            # Nonzero is expected when a deferred leg has an intrabar stop overlay.
            "max_defer_drift_pct": max(
                (o.defer_drift_pct for o in graded if o.defer_drift_pct is not None),
                default=0.0,
            ),
        },
        "cases": [o.__dict__ for o in outcomes],
    }

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report["metrics"], indent=2))
    for o in outcomes:
        if not o.passed:
            print(f"  FAIL {o.id}: {'; '.join(o.failure_reasons)}", file=sys.stderr)

    if args.baseline and Path(args.baseline).exists():
        baseline = json.loads(Path(args.baseline).read_text())
        prev_pr = baseline.get("metrics", {}).get("pass_rate", 0)
        if pass_rate + 0.02 < prev_pr:
            print(f"REGRESSION: pass_rate {pass_rate:.2%} vs baseline {prev_pr:.2%}", file=sys.stderr)
            return 1

    return 0 if pass_rate >= 0.5 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
