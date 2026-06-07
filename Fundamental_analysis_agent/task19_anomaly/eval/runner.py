"""Task 19 eval runner — price anomalies (52w-high / MAX / tax-loss). Built on shared.eval_harness.

Pass/fail rides on lookahead invariants (no episode before window start, benchmark
anchored at 1.0, metrics in range) + graceful failure + cost/time caps. The
LLM-chosen signal is RECORDED, not graded. Usage:
    python -m task19_anomaly.eval.runner
    python -m task19_anomaly.eval.runner --filter <id>
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from shared.eval_harness import CaseOutcome, check_caps, factor_invariants, run_suite
from task19_anomaly.pipeline.orchestrator import run_anomaly_pipeline, TickerNotFound, new_job_id

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
OUTPUT = "task19_anomaly/eval/report.json"


async def _run_case(case: dict) -> CaseOutcome:
    started = datetime.now(timezone.utc)
    result = error = None
    try:
        result = await run_anomaly_pipeline(ticker=case["ticker"], job_id=new_job_id())
    except Exception as e:  # noqa: BLE001
        error = e
    dur = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    asserts = case.get("assertions", {})
    base = dict(id=case["id"], category=case.get("category", "uncategorized"), label=case["ticker"])

    if asserts.get("expect_failed"):
        ok = error is not None
        return CaseOutcome(**base, passed=ok, status=("failed" if error else "succeeded"),
                           duration_ms=dur, failure_reasons=[] if ok else ["expected failure but completed"])
    if error is not None:
        return CaseOutcome(**base, passed=False, status="failed", duration_ms=dur,
                           failure_reasons=[f"crashed: {type(error).__name__}: {error}"])

    reasons = factor_invariants(result.backtest)
    exp = asserts.get("expect_signal_in")
    if exp and result.strategy.entry_signal not in exp:
        reasons.append(f"entry_signal={result.strategy.entry_signal} not in {exp}")
    reasons += check_caps(asserts, result.cost_usd, dur)
    m = result.backtest.metrics
    recorded = {"entry_signal": result.strategy.entry_signal, "total_return_pct": m.total_return_pct,
                "sharpe": m.sharpe, "exposure_pct": m.exposure_pct, "n_trades": m.n_trades,
                "alpha_vs_market_pct": m.excess_vs_market_pct}
    return CaseOutcome(**base, passed=(len(reasons) == 0), status="succeeded", duration_ms=dur,
                       cost_usd=result.cost_usd, failure_reasons=reasons, recorded=recorded)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_suite(eval_set=EVAL_SET, default_output=OUTPUT, run_case=_run_case)))
