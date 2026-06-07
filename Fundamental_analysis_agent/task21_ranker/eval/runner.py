"""Task 21 eval runner — cross-sectional ranker + SURVIVORSHIP / data-integrity checks.

Graded on portfolio lookahead invariants (equal-weight benchmark anchored at 1.0,
curve starts at the window start, gross exposure in range) + graceful failure +
cost/time caps, PLUS data-integrity assertions specific to a watchlist agent:
  - a watchlist containing a delisted/bad ticker must DROP it, still succeed, and the
    survivorship caveat must be present (expect_dropped_contains / expect_survivorship_caveat).
  - the universe actually backtested is a strict subset when names are dropped.
The LLM-chosen factor is recorded, not graded. Usage: python -m task21_ranker.eval.runner
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path

from shared.eval_harness import CaseOutcome, check_caps, portfolio_invariants, run_suite
from task21_ranker.pipeline.orchestrator import NotEnoughNames, new_job_id, run_rank_pipeline

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
OUTPUT = "task21_ranker/eval/report.json"


async def _run_case(case: dict) -> CaseOutcome:
    started = datetime.now(timezone.utc)
    result = error = None
    tickers = [t.strip().upper() for t in re.split(r"[,\s]+", case["tickers"]) if t.strip()]
    try:
        result = await run_rank_pipeline(tickers=tickers, job_id=new_job_id())
    except Exception as e:  # noqa: BLE001
        error = e
    dur = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    asserts = case.get("assertions", {})
    base = dict(id=case["id"], category=case.get("category", "uncategorized"), label=case["id"])

    if asserts.get("expect_failed"):
        ok = error is not None
        return CaseOutcome(**base, passed=ok, status=("failed" if error else "succeeded"),
                           duration_ms=dur, failure_reasons=[] if ok else ["expected failure but completed"])
    if error is not None:
        return CaseOutcome(**base, passed=False, status="failed", duration_ms=dur,
                           failure_reasons=[f"crashed: {type(error).__name__}: {error}"])

    reasons = portfolio_invariants(result.equity_curve, result.metrics, result.common_window_start)
    # ---- survivorship / data-integrity ----
    dropped = [h.ticker for h in result.holdings if not h.available]
    want_dropped = asserts.get("expect_dropped_contains")
    if want_dropped and want_dropped.upper() not in dropped:
        reasons.append(f"expected {want_dropped} to be dropped (no usable history); dropped={dropped}")
    if asserts.get("expect_survivorship_caveat"):
        if not any("survivorship" in c.lower() for c in result.caveats):
            reasons.append("survivorship caveat missing from result")
    min_used = asserts.get("expect_min_universe")
    if min_used is not None and len(result.tickers) < min_used:
        reasons.append(f"universe used {len(result.tickers)} < expected ≥ {min_used}")
    reasons += check_caps(asserts, result.cost_usd, dur)
    recorded = {"factor": result.spec.factor, "top_n": result.spec.top_n,
                "n_universe": len(result.tickers), "dropped": dropped,
                "total_return_pct": result.metrics.total_return_pct, "sharpe": result.metrics.sharpe,
                "excess_vs_basket_pct": result.metrics.excess_return_pct}
    return CaseOutcome(**base, passed=(len(reasons) == 0), status="succeeded", duration_ms=dur,
                       cost_usd=result.cost_usd, failure_reasons=reasons, recorded=recorded)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_suite(eval_set=EVAL_SET, default_output=OUTPUT, run_case=_run_case)))
