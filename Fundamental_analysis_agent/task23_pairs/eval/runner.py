"""Task 23 eval runner — pairs trading + DATA-INTEGRITY checks.

Graded on market-neutral lookahead invariants (equity curve anchored at 1.0, no
trade entry before the window start, metrics in range) + graceful failure + cost/time
caps, PLUS a data-integrity guard specific to stat-arb: the engine must REPORT the
honest correlation/half-life so an unrelated "pair" is exposed as noise rather than
dressed up — we assert a known co-moving pair clears a correlation floor and an
unrelated pair is recorded (not graded high). Usage: python -m task23_pairs.eval.runner
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from shared.eval_harness import CaseOutcome, check_caps, run_suite
from task23_pairs.pipeline.orchestrator import TickerNotFound, new_job_id, run_pairs_pipeline

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
OUTPUT = "task23_pairs/eval/report.json"


def _pairs_invariants(r) -> list[str]:
    reasons: list[str] = []
    ec = r.equity_curve
    if ec:
        if abs(ec[0].benchmark - 1.0) > 1e-6:
            reasons.append(f"benchmark not anchored at 1.0 (got {ec[0].benchmark})")
        if abs(ec[0].strategy - 1.0) > 1e-6:
            reasons.append(f"strategy not anchored at 1.0 (got {ec[0].strategy})")
        if ec[0].date != r.common_window_start:
            reasons.append(f"curve starts {ec[0].date} != window start {r.common_window_start}")
    for t in r.trades:
        if t.entry_date < r.common_window_start:
            reasons.append(f"trade opens {t.entry_date} before window start {r.common_window_start}")
            break
    m = r.metrics
    if not (0.0 <= m.exposure_pct <= 100.0):
        reasons.append(f"exposure_pct out of range: {m.exposure_pct}")
    if m.days <= 0:
        reasons.append(f"non-positive days: {m.days}")
    return reasons


async def _run_case(case: dict) -> CaseOutcome:
    started = datetime.now(timezone.utc)
    result = error = None
    try:
        result = await run_pairs_pipeline(ticker_a=case["ticker_a"], ticker_b=case["ticker_b"], job_id=new_job_id())
    except Exception as e:  # noqa: BLE001
        error = e
    dur = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    asserts = case.get("assertions", {})
    base = dict(id=case["id"], category=case.get("category", "uncategorized"),
                label=f"{case['ticker_a']}/{case['ticker_b']}")

    if asserts.get("expect_failed"):
        ok = error is not None
        return CaseOutcome(**base, passed=ok, status=("failed" if error else "succeeded"),
                           duration_ms=dur, failure_reasons=[] if ok else ["expected failure but completed"])
    if error is not None:
        return CaseOutcome(**base, passed=False, status="failed", duration_ms=dur,
                           failure_reasons=[f"crashed: {type(error).__name__}: {error}"])

    reasons = _pairs_invariants(result)
    # data-integrity: a pairing asserted to be co-moving must clear a correlation floor
    corr = float(result.pair_readings.get("return_correlation", 0.0))
    floor = asserts.get("min_correlation")
    if floor is not None and corr < floor:
        reasons.append(f"return_correlation {corr} < expected floor {floor} (is this really a pair?)")
    reasons += check_caps(asserts, result.cost_usd, dur)
    m = result.metrics
    recorded = {"correlation": corr, "half_life_days": result.pair_readings.get("half_life_days"),
                "z_entry": result.spec.z_entry, "total_return_pct": m.total_return_pct,
                "sharpe": m.sharpe, "n_trades": m.n_trades, "exposure_pct": m.exposure_pct}
    return CaseOutcome(**base, passed=(len(reasons) == 0), status="succeeded", duration_ms=dur,
                       cost_usd=result.cost_usd, failure_reasons=reasons, recorded=recorded)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_suite(eval_set=EVAL_SET, default_output=OUTPUT, run_case=_run_case)))
