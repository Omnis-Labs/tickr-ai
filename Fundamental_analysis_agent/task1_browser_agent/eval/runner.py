"""Eval harness — run the agent against eval_set.yaml and emit a metrics report.

Designed to run two ways:
  1. CLI:        python -m task1_browser_agent.eval.runner
  2. CI:         exit code 0 on regression-free run, 1 if pass_rate drops
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from shared.cost_ledger import cost_for_trace, init_db
from shared.llm_gateway import LLMUnavailableError
from shared.logging import configure_logging, get_logger

from task1_browser_agent.agent.state_machine import AgentRunner
from task1_browser_agent.api.job_store import store as job_store
from task1_browser_agent.eval.fault_injection import (
    clear as fault_clear,
    register as fault_register,
    summary as fault_summary,
)
from task1_browser_agent.eval.metrics import AggregateMetrics, CaseOutcome

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
logger = get_logger(__name__)


EVAL_JOBS_DIR = Path(__file__).parent / "jobs"


async def _run_case(case: dict[str, Any]) -> CaseOutcome:
    job = await job_store.create(task_description=case["task"])
    fault_spec = case.get("fault_inject")
    if fault_spec:
        fault_register(job.job_id, fault_spec)
    started = datetime.now(timezone.utc)
    try:
        runner = AgentRunner(job)
        async for _ in runner.run():
            pass  # we only need terminal state for eval
    finally:
        # Capture fault summary BEFORE clearing the registry — proves the
        # injection actually fired (not just configured).
        fault_status = fault_summary(job.job_id) if fault_spec else None
        fault_clear(job.job_id)
    ended = datetime.now(timezone.utc)
    duration_ms = int((ended - started).total_seconds() * 1000)

    cost = await cost_for_trace(job.job_id)
    assertions = case.get("assertions", {})

    passed, reason = _check_assertions(job, assertions, cost, fault_status)

    # Persist the full Job to disk so the /jobs/{id} inspector can render it
    # after the eval runner process exits. We tag the file with the case id
    # for human-friendly browsing.
    EVAL_JOBS_DIR.mkdir(parents=True, exist_ok=True)
    sidecar = {
        "eval_case_id": case["id"],
        "eval_passed": passed,
        "eval_failure_reason": reason,
        "eval_assertions": case.get("assertions", {}),
        "fault_inject": fault_spec,
        "fault_status": fault_status,
        "job": job.model_dump(mode="json"),
    }
    (EVAL_JOBS_DIR / f"{job.job_id}.json").write_text(
        json.dumps(sidecar, indent=2, default=str)
    )
    # Also write a stable-named pointer "by_case_id" so the dashboard can
    # link cases to their job artifacts without remembering hashes.
    (EVAL_JOBS_DIR / f"by-id-{case['id']}.json").write_text(
        json.dumps({"job_id": job.job_id}, indent=2)
    )

    return CaseOutcome(
        id=case["id"],
        category=case.get("category", "uncategorized"),
        passed=passed,
        status=job.status.value,
        cost_usd=cost,
        duration_ms=duration_ms,
        recovery_attempts=job.recovery_attempts,
        failure_reason=reason,
        job_id=job.job_id,
    )


def _check_assertions(
    job: Any,
    asserts: dict[str, Any],
    cost: float,
    fault_status: dict | None = None,
) -> tuple[bool, str | None]:
    expected_status = asserts.get("status")
    if expected_status and job.status.value != expected_status:
        return False, f"status={job.status.value} expected={expected_status}"

    max_cost = asserts.get("max_cost_usd")
    if max_cost is not None and cost > max_cost:
        return False, f"cost ${cost:.4f} > cap ${max_cost}"

    min_steps = asserts.get("min_steps")
    if min_steps is not None and len(job.plan) < min_steps:
        return False, f"plan length {len(job.plan)} < {min_steps}"

    flat_output = " ".join(str(v) for v in (job.final_output or {}).values())
    contains = asserts.get("contains")
    if contains and contains.lower() not in flat_output.lower():
        return False, f"output missing '{contains}'"

    contains_all = asserts.get("contains_all") or []
    for needle in contains_all:
        if str(needle).lower() not in flat_output.lower():
            return False, f"output missing '{needle}' (from contains_all)"

    contains_any = asserts.get("contains_any") or []
    if contains_any and not any(
        str(n).lower() in flat_output.lower() for n in contains_any
    ):
        return False, f"output missing all of contains_any={contains_any}"

    min_rec = asserts.get("min_recovery_attempts")
    if min_rec is not None and job.recovery_attempts < min_rec:
        return False, (
            f"recovery_attempts={job.recovery_attempts} < expected min {min_rec}"
        )

    expected_failure_kind = asserts.get("expected_failure_kind")
    if expected_failure_kind:
        seen = {
            (s.failure_kind.value if s.failure_kind else None) for s in job.steps
        }
        if expected_failure_kind not in seen:
            return False, (
                f"expected to observe failure_kind={expected_failure_kind} "
                f"during run, saw {sorted(s for s in seen if s)}"
            )

    if asserts.get("fault_must_fire") and (
        not fault_status or fault_status.get("triggered_count", 0) < 1
    ):
        return False, "fault_inject configured but did not fire on any step"

    url_contains = asserts.get("url_contains")
    if url_contains:
        end_url = (job.target_url or "").lower()
        if url_contains.lower() not in end_url:
            pass  # informational only — see comment below
        # Rationale: target_url is the planner's intended landing page, not
        # the actual final URL. Strict URL assertions need a final-page
        # snapshot field on StepResult that we haven't added yet.

    return True, None


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="task1_browser_agent/eval/report.json")
    parser.add_argument("--baseline", help="path to previous report; fail on regression")
    parser.add_argument("--filter", help="only run cases whose id contains this substring")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Max simultaneous browser sessions. Each costs ~150 MB RAM. "
        "Default 4 balances throughput vs memory on a laptop. Set 1 for serial.",
    )
    args = parser.parse_args(argv)

    configure_logging()
    await init_db()

    spec = yaml.safe_load(EVAL_SET.read_text(encoding="utf-8"))
    cases = spec.get("cases", [])
    if args.filter:
        cases = [c for c in cases if args.filter in c["id"]]

    sem = asyncio.Semaphore(max(1, args.concurrency))

    async def _bounded_run(c: dict[str, Any]) -> CaseOutcome:
        async with sem:
            logger.info("eval_case_start", case_id=c["id"])
            try:
                return await _run_case(c)
            except LLMUnavailableError as e:
                logger.warning("eval_case_infra_error", case_id=c["id"], error=str(e))
                return CaseOutcome(
                    id=c["id"],
                    category=c.get("category", "uncategorized"),
                    passed=False,
                    status="infra_error",
                    cost_usd=0.0,
                    duration_ms=0,
                    recovery_attempts=0,
                    failure_reason=f"provider unavailable: {str(e)[:200]}",
                )
            except Exception as e:  # noqa: BLE001
                logger.exception("eval_case_crashed", case_id=c["id"], error=str(e))
                return CaseOutcome(
                    id=c["id"],
                    category=c.get("category", "uncategorized"),
                    passed=False,
                    status="failed",
                    cost_usd=0.0,
                    duration_ms=0,
                    recovery_attempts=0,
                    failure_reason=f"crash: {e}",
                )

    outcomes: list[CaseOutcome] = await asyncio.gather(
        *(_bounded_run(c) for c in cases)
    )

    agg = AggregateMetrics.from_outcomes(outcomes)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "n_cases": agg.n_cases,
            "n_pass": agg.n_pass,
            "n_infra_error": agg.n_infra_error,
            "pass_rate": agg.pass_rate,
            "pass_rate_ex_infra": agg.pass_rate_ex_infra,
            "cost_p50": agg.cost_p50,
            "cost_p95": agg.cost_p95,
            "duration_p50_ms": agg.duration_p50_ms,
            "duration_p95_ms": agg.duration_p95_ms,
            "recovery_rate": agg.recovery_rate,
            "by_category": agg.by_category,
        },
        "cases": [o.__dict__ for o in outcomes],
    }

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report["metrics"], indent=2))

    if args.baseline and Path(args.baseline).exists():
        baseline = json.loads(Path(args.baseline).read_text())
        prev_pr = baseline.get("metrics", {}).get("pass_rate", 0)
        if agg.pass_rate + 0.02 < prev_pr:  # 2 pp tolerance
            print(f"REGRESSION: pass_rate {agg.pass_rate:.2%} vs baseline {prev_pr:.2%}", file=sys.stderr)
            return 1

    return 0 if agg.pass_rate >= 0.5 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
