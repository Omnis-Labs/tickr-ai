"""Task 24 eval runner — earnings contagion (bellwether → peer). shared.eval_harness.

Same factor invariants as the single-ticker agents, but the case input is a
(bellwether, peer) pair. The peer's backtest is graded; the LLM read-across choice
is recorded. Usage: python -m task24_contagion.eval.runner
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from shared.eval_harness import CaseOutcome, check_caps, factor_invariants, run_suite
from task24_contagion.pipeline.orchestrator import TickerNotFound, new_job_id, run_contagion_pipeline

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
OUTPUT = "task24_contagion/eval/report.json"


async def _run_case(case: dict) -> CaseOutcome:
    started = datetime.now(timezone.utc)
    result = error = None
    try:
        result = await run_contagion_pipeline(bellwether=case["bellwether"], peer=case["peer"], job_id=new_job_id())
    except Exception as e:  # noqa: BLE001
        error = e
    dur = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    asserts = case.get("assertions", {})
    base = dict(id=case["id"], category=case.get("category", "uncategorized"),
                label=f"{case['bellwether']}→{case['peer']}")

    if asserts.get("expect_failed"):
        ok = error is not None
        return CaseOutcome(**base, passed=ok, status=("failed" if error else "succeeded"),
                           duration_ms=dur, failure_reasons=[] if ok else ["expected failure but completed"])
    if error is not None:
        return CaseOutcome(**base, passed=False, status="failed", duration_ms=dur,
                           failure_reasons=[f"crashed: {type(error).__name__}: {error}"])

    reasons = factor_invariants(result.backtest)
    reasons += check_caps(asserts, result.cost_usd, dur)
    m = result.backtest.metrics
    recorded = {"entry_signal": result.strategy.entry_signal, "n_events": result.n_events,
                "total_return_pct": m.total_return_pct, "sharpe": m.sharpe, "exposure_pct": m.exposure_pct}
    return CaseOutcome(**base, passed=(len(reasons) == 0), status="succeeded", duration_ms=dur,
                       cost_usd=result.cost_usd, failure_reasons=reasons, recorded=recorded)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_suite(eval_set=EVAL_SET, default_output=OUTPUT, run_case=_run_case)))
