"""Task 9 eval runner — grades invariants + deterministic behaviour, records the
stochastic LLM choice.

Usage:
    python -m task9_institutional.eval.runner
    python -m task9_institutional.eval.runner --filter aapl --concurrency 1
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from shared.cost_ledger import init_db
from shared.logging import configure_logging, get_logger

from task9_institutional.pipeline.orchestrator import new_job_id, run_institutional_pipeline
from task9_institutional.schemas import InstitutionalResult

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
logger = get_logger(__name__)


@dataclass
class CaseOutcome:
    id: str
    category: str
    ticker: str
    passed: bool
    status: str
    n_funds_holding: int | None = None
    regime: str | None = None
    entry_signal: str | None = None
    total_return_pct: float | None = None
    alpha_vs_market_pct: float | None = None
    duration_ms: int = 0
    cost_usd: float = 0.0
    failure_reasons: list[str] = field(default_factory=list)


def _invariants(r: InstitutionalResult) -> list[str]:
    reasons = []
    bt = r.backtest
    for t in bt.trades:
        if t.entry_date < bt.start_date:
            reasons.append(f"trade opens {t.entry_date} before window {bt.start_date}"); break
    if bt.equity_curve and abs(bt.equity_curve[0].benchmark - 1.0) > 1e-6:
        reasons.append(f"benchmark not anchored at 1.0 (got {bt.equity_curve[0].benchmark})")
    if not (0.0 <= bt.metrics.exposure_pct <= 100.0):
        reasons.append(f"exposure out of range: {bt.metrics.exposure_pct}")
    if bt.metrics.days <= 0:
        reasons.append(f"non-positive days: {bt.metrics.days}")
    return reasons


def _check(case, result: InstitutionalResult | None, error, duration_ms) -> tuple[bool, list[str]]:
    a = case.get("assertions", {})
    if a.get("expect_failed"):
        if error is None:
            return False, ["expected failure but pipeline completed"]
        return True, []
    if error is not None:
        return False, [f"crashed: {type(error).__name__}: {error}"]
    assert result is not None
    reasons = _invariants(result)
    if (mf := a.get("min_funds_holding")) is not None and result.n_funds_holding < mf:
        reasons.append(f"funds_holding {result.n_funds_holding} < min {mf}")
    if (mc := a.get("max_cost_usd")) is not None and result.cost_usd > mc:
        reasons.append(f"cost ${result.cost_usd:.4f} > ${mc}")
    if (md := a.get("max_duration_ms")) is not None and duration_ms > md:
        reasons.append(f"duration {duration_ms}ms > {md}ms")
    return (not reasons), reasons


async def _run_case(case: dict[str, Any]) -> CaseOutcome:
    error = None; result = None
    started = datetime.now(timezone.utc)
    try:
        result = await run_institutional_pipeline(ticker=case["ticker"], job_id=new_job_id())
    except Exception as e:  # noqa: BLE001
        error = e
    dur = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    passed, reasons = _check(case, result, error, dur)
    o = CaseOutcome(id=case["id"], category=case.get("category", "?"), ticker=case["ticker"],
                    passed=passed, status=("failed" if error else "succeeded"),
                    duration_ms=dur, failure_reasons=reasons)
    if result:
        o.n_funds_holding = result.n_funds_holding
        o.regime = str(result.institutional_readings.get("institutional_regime"))
        o.entry_signal = result.strategy.entry_signal
        o.total_return_pct = result.backtest.metrics.total_return_pct
        o.alpha_vs_market_pct = result.backtest.metrics.excess_vs_market_pct
        o.cost_usd = result.cost_usd
    return o


async def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="task9_institutional/eval/report.json")
    p.add_argument("--filter"); p.add_argument("--baseline")
    p.add_argument("--concurrency", type=int, default=1)  # heavy (many SEC fetches per case)
    args = p.parse_args(argv)

    configure_logging(); await init_db()
    cases = yaml.safe_load(EVAL_SET.read_text())["cases"]
    if args.filter:
        cases = [c for c in cases if args.filter in c["id"]]
    sem = asyncio.Semaphore(max(1, args.concurrency))

    async def _b(c):
        async with sem:
            logger.info("eval_case_start", case_id=c["id"], ticker=c["ticker"])
            return await _run_case(c)

    outcomes = await asyncio.gather(*(_b(c) for c in cases))
    n_pass = sum(1 for o in outcomes if o.passed)
    graded = [o for o in outcomes if o.status == "succeeded"]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "n_cases": len(outcomes), "n_pass": n_pass,
            "pass_rate": n_pass / max(1, len(outcomes)),
            "cost_total": sum(o.cost_usd for o in graded),
        },
        "cases": [o.__dict__ for o in outcomes],
    }
    Path(args.output).write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report["metrics"], indent=2))
    for o in outcomes:
        if not o.passed:
            print(f"  FAIL {o.id}: {'; '.join(o.failure_reasons)}", file=sys.stderr)
    if args.baseline and Path(args.baseline).exists():
        prev = json.loads(Path(args.baseline).read_text()).get("metrics", {}).get("pass_rate", 0)
        if report["metrics"]["pass_rate"] + 0.02 < prev:
            print(f"REGRESSION vs baseline {prev:.2%}", file=sys.stderr); return 1
    return 0 if report["metrics"]["pass_rate"] >= 0.5 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
