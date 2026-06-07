"""Shared eval harness — the Task-5-style runner, factored out for T17–T24.

Every strategy agent's eval rides on what is DETERMINISTIC: lookahead invariants
(asserted on every successful case), graceful failure, and cost/time caps; the
stochastic LLM choice is recorded, not graded. This module supplies the reusable
pieces so each agent's runner is ~50 lines:

  - load_cases / percentile / write_report / run_suite (the orchestration shell)
  - factor_invariants  — for agents returning a Task-4 BacktestResult
  - portfolio_invariants — for the multi-name book agents (T21)
  - check_caps         — cost / duration ceilings

A runner provides one async `run_case(case) -> CaseOutcome` and calls `run_suite`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import yaml

from shared.cost_ledger import init_db
from shared.logging import configure_logging, get_logger

logger = get_logger(__name__)


@dataclass
class CaseOutcome:
    id: str
    category: str
    label: str
    passed: bool
    status: str                       # "succeeded" | "failed"
    duration_ms: int = 0
    cost_usd: float = 0.0
    failure_reasons: list[str] = field(default_factory=list)
    recorded: dict[str, Any] = field(default_factory=dict)   # soft outcomes, surfaced not graded


def percentile(vals: list[float], p: int) -> float:
    if not vals:
        return 0.0
    vs = sorted(vals)
    k = (len(vs) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(vs) - 1)
    return float(vs[f] if f == c else vs[f] + (vs[c] - vs[f]) * (k - f))


def check_caps(asserts: dict, cost_usd: float, duration_ms: int) -> list[str]:
    reasons: list[str] = []
    mc = asserts.get("max_cost_usd")
    if mc is not None and cost_usd > mc:
        reasons.append(f"cost ${cost_usd:.4f} > cap ${mc}")
    md = asserts.get("max_duration_ms")
    if md is not None and duration_ms > md:
        reasons.append(f"duration {duration_ms}ms > cap {md}ms")
    return reasons


def _metrics_in_range(m: Any) -> list[str]:
    reasons: list[str] = []
    exp = getattr(m, "exposure_pct", None)
    if exp is not None and not (0.0 <= exp <= 100.0):
        reasons.append(f"exposure_pct out of range: {exp}")
    if getattr(m, "days", 1) <= 0:
        reasons.append(f"non-positive backtest days: {m.days}")
    wr = getattr(m, "win_rate_pct", None)
    if wr is not None and not (0.0 <= wr <= 100.0):
        reasons.append(f"win_rate_pct out of range: {wr}")
    return reasons


def factor_invariants(bt: Any) -> list[str]:
    """Lookahead invariants for a Task-4 BacktestResult: no episode opens before the
    window start, the benchmark anchors at 1.0 on bar 0, metrics are in range."""
    reasons: list[str] = []
    start = bt.start_date
    for t in bt.trades:
        if t.entry_date < start:
            reasons.append(f"episode opens {t.entry_date} before window start {start}")
            break
    if bt.equity_curve:
        if abs(bt.equity_curve[0].benchmark - 1.0) > 1e-6:
            reasons.append(f"benchmark not anchored at 1.0 on bar 0 (got {bt.equity_curve[0].benchmark})")
        if bt.equity_curve[0].date != start:
            reasons.append(f"equity curve starts {bt.equity_curve[0].date} != window start {start}")
    reasons.extend(_metrics_in_range(bt.metrics))
    return reasons


def portfolio_invariants(equity_curve: list, metrics: Any, window_start: date) -> list[str]:
    """Lookahead invariants for a multi-name book (T21): the equal-weight benchmark
    anchors at 1.0 on bar 0, the curve starts at the window start, metrics in range."""
    reasons: list[str] = []
    if equity_curve:
        if abs(equity_curve[0].benchmark - 1.0) > 1e-6:
            reasons.append(f"benchmark not anchored at 1.0 on bar 0 (got {equity_curve[0].benchmark})")
        if equity_curve[0].date != window_start:
            reasons.append(f"curve starts {equity_curve[0].date} != window start {window_start}")
    if getattr(metrics, "days", 1) <= 0:
        reasons.append(f"non-positive days: {metrics.days}")
    gross = getattr(metrics, "avg_gross_exposure_pct", 0.0)
    if not (0.0 <= gross <= 105.0):
        reasons.append(f"avg gross exposure out of range: {gross}")
    return reasons


def load_cases(path: Path, filt: str | None) -> list[dict]:
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    cases = spec.get("cases", [])
    return [c for c in cases if not filt or filt in c["id"]]


def write_report(outcomes: list[CaseOutcome], output: str, *, extra: dict | None = None) -> dict:
    n_pass = sum(1 for o in outcomes if o.passed)
    graded = [o for o in outcomes if o.status == "succeeded"]
    costs = [o.cost_usd for o in graded]
    durs = [float(o.duration_ms) for o in graded]
    by_category: dict[str, dict] = {}
    for o in outcomes:
        b = by_category.setdefault(o.category, {"n": 0, "n_pass": 0})
        b["n"] += 1
        b["n_pass"] += 1 if o.passed else 0
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "n_cases": len(outcomes), "n_pass": n_pass,
            "pass_rate": n_pass / max(1, len(outcomes)),
            "cost_p50": percentile(costs, 50), "cost_p95": percentile(costs, 95), "cost_total": sum(costs),
            "duration_p50_ms": percentile(durs, 50), "duration_p95_ms": percentile(durs, 95),
            "by_category": by_category,
            **(extra or {}),
        },
        "cases": [asdict(o) for o in outcomes],
    }
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(report, indent=2, default=str))
    return report


async def run_suite(
    *, eval_set: Path, default_output: str, run_case: Callable[[dict], Awaitable[CaseOutcome]],
    default_concurrency: int = 2, min_pass: float = 0.5, argv: list[str] | None = None,
) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=default_output)
    parser.add_argument("--filter")
    parser.add_argument("--baseline")
    parser.add_argument("--concurrency", type=int, default=default_concurrency)
    args = parser.parse_args(argv)

    configure_logging()
    await init_db()
    cases = load_cases(eval_set, args.filter)
    sem = asyncio.Semaphore(max(1, args.concurrency))

    async def _bounded(c: dict) -> CaseOutcome:
        async with sem:
            logger.info("eval_case_start", case_id=c["id"])
            return await run_case(c)

    outcomes = await asyncio.gather(*(_bounded(c) for c in cases))
    report = write_report(outcomes, args.output)
    print(json.dumps(report["metrics"], indent=2, ensure_ascii=False))
    for o in outcomes:
        if not o.passed:
            print(f"  FAIL {o.id}: {'; '.join(o.failure_reasons)}", file=sys.stderr)

    pass_rate = report["metrics"]["pass_rate"]
    if args.baseline and Path(args.baseline).exists():
        prev = json.loads(Path(args.baseline).read_text()).get("metrics", {}).get("pass_rate", 0)
        if pass_rate + 0.02 < prev:
            print(f"REGRESSION: pass_rate {pass_rate:.2%} vs baseline {prev:.2%}", file=sys.stderr)
            return 1
    return 0 if pass_rate >= min_pass else 1
