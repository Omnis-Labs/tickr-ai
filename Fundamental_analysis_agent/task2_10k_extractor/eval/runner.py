"""Task 2 eval runner — same shape as Task 1's, fields specific to extraction.

Usage:
    python -m task2_10k_extractor.eval.runner
    python -m task2_10k_extractor.eval.runner --filter aapl
    python -m task2_10k_extractor.eval.runner --baseline task2_10k_extractor/eval/report-baseline.json
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

from task2_10k_extractor.pipeline.orchestrator import run_pipeline

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
logger = get_logger(__name__)


@dataclass
class CaseOutcome:
    id: str
    industry: str
    company: str
    passed: bool
    quarantined: bool
    n_items_found: int
    overall_confidence: float
    coverage_ratio: float
    duration_ms: int
    cost_usd: float
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


def _check(case: dict, result, error: Exception | None) -> tuple[bool, list[str]]:
    """Validate a single case against its assertions.

    Returns (passed, failure_reasons).
    """
    asserts = case.get("assertions", {})
    reasons: list[str] = []

    if asserts.get("expect_failed"):
        if error is None:
            return False, ["expected failure but pipeline completed"]
        return True, []

    if error is not None:
        return False, [f"crashed: {type(error).__name__}: {error}"]

    # Required items
    found_ids = {it.item_id for it in result.items}
    for rid in asserts.get("required_item_ids", []) or []:
        if rid not in found_ids:
            reasons.append(f"required item {rid!r} missing")

    # Item count floor
    min_items = asserts.get("min_items_found")
    if min_items is not None and len(result.items) < min_items:
        reasons.append(f"items {len(result.items)} < min {min_items}")

    # Confidence floor
    min_conf = asserts.get("min_overall_confidence")
    if min_conf is not None and result.overall_confidence < min_conf:
        reasons.append(
            f"confidence {result.overall_confidence:.3f} < min {min_conf}"
        )

    # Quarantine
    if asserts.get("max_quarantined") is False and result.quarantined:
        reasons.append(f"quarantined: {result.quarantine_reasons}")

    # Cost
    max_cost = asserts.get("max_cost_usd")
    if max_cost is not None and result.cost_usd > max_cost:
        reasons.append(f"cost ${result.cost_usd:.4f} > cap ${max_cost}")

    # Duration
    max_dur = asserts.get("max_duration_ms")
    if max_dur is not None and result.duration_ms > max_dur:
        reasons.append(f"duration {result.duration_ms}ms > cap {max_dur}ms")

    # Content checks
    by_id = {it.item_id: it for it in result.items}
    for iid, needle in (asserts.get("item_contains") or {}).items():
        it = by_id.get(iid)
        if not it:
            reasons.append(f"item {iid} not found for content check")
            continue
        if str(needle).lower() not in it.content.lower():
            reasons.append(f"item {iid} content missing {needle!r}")

    # Method check
    for iid, expected_method in (asserts.get("expected_method") or {}).items():
        it = by_id.get(iid)
        if not it:
            reasons.append(f"item {iid} not found for method check")
            continue
        if it.extraction_method != expected_method:
            reasons.append(
                f"item {iid} method={it.extraction_method} expected {expected_method}"
            )

    return (len(reasons) == 0), reasons


async def _run_case(case: dict[str, Any]) -> CaseOutcome:
    error: Exception | None = None
    result = None
    started = datetime.now(timezone.utc)
    try:
        result = await run_pipeline(url=case["url"])
    except Exception as e:  # noqa: BLE001
        error = e
    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)

    passed, reasons = _check(case, result, error)
    return CaseOutcome(
        id=case["id"],
        industry=case.get("industry", "uncategorized"),
        company=case.get("company", "?"),
        passed=passed,
        quarantined=result.quarantined if result else False,
        n_items_found=len(result.items) if result else 0,
        overall_confidence=result.overall_confidence if result else 0.0,
        coverage_ratio=result.coverage_ratio if result else 0.0,
        duration_ms=result.duration_ms if result else duration_ms,
        cost_usd=result.cost_usd if result else 0.0,
        failure_reasons=reasons,
    )


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="task2_10k_extractor/eval/report.json")
    parser.add_argument("--filter")
    parser.add_argument("--baseline")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Max simultaneous EDGAR fetches + parsings. Task 2 is mostly IO "
        "and lxml, so 4 is fine on a laptop. Set 1 for serial.",
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
            logger.info("eval_case_start", case_id=c["id"])
            return await _run_case(c)

    outcomes: list[CaseOutcome] = await asyncio.gather(*(_bounded(c) for c in cases))
    if False:  # kept for type hints from the legacy serial block
        outcomes.append(await _run_case(cases[0]))

    n_pass = sum(1 for o in outcomes if o.passed)
    n_quarantined = sum(1 for o in outcomes if o.quarantined)
    pass_rate = n_pass / max(1, len(outcomes))

    successes = [o for o in outcomes if o.passed]
    costs = [o.cost_usd for o in successes]
    durs = [o.duration_ms for o in successes]

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "n_cases": len(outcomes),
            "n_pass": n_pass,
            "n_quarantined": n_quarantined,
            "pass_rate": pass_rate,
            "cost_p50": _percentile(costs, 50),
            "cost_p95": _percentile(costs, 95),
            "duration_p50_ms": _percentile(durs, 50),
            "duration_p95_ms": _percentile(durs, 95),
            "mean_confidence": mean(o.overall_confidence for o in successes) if successes else 0.0,
            "mean_coverage": mean(o.coverage_ratio for o in successes) if successes else 0.0,
        },
        "cases": [o.__dict__ for o in outcomes],
    }

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report["metrics"], indent=2))

    if args.baseline and Path(args.baseline).exists():
        baseline = json.loads(Path(args.baseline).read_text())
        prev_pr = baseline.get("metrics", {}).get("pass_rate", 0)
        if pass_rate + 0.02 < prev_pr:
            print(
                f"REGRESSION: pass_rate {pass_rate:.2%} vs baseline {prev_pr:.2%}",
                file=sys.stderr,
            )
            return 1

    return 0 if pass_rate >= 0.5 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
