"""Task 10 eval runner — grades portfolio invariants + deterministic degradation,
records the stochastic LLM sizing policy.

Usage:
    python -m task10_portfolio.eval.runner
    python -m task10_portfolio.eval.runner --filter core --concurrency 1
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

from task10_portfolio.pipeline.orchestrator import new_job_id, run_portfolio_pipeline
from task10_portfolio.schemas import PortfolioResult

EVAL_SET = Path(__file__).parent / "eval_set.yaml"
logger = get_logger(__name__)


@dataclass
class CaseOutcome:
    id: str
    category: str
    tickers: list[str]
    passed: bool
    status: str
    method: str | None = None
    n_holdings: int | None = None
    total_return_pct: float | None = None
    excess_vs_basket_pct: float | None = None
    alpha_vs_market_pct: float | None = None
    sharpe: float | None = None
    duration_ms: int = 0
    cost_usd: float = 0.0
    failure_reasons: list[str] = field(default_factory=list)


def _invariants(r: PortfolioResult) -> list[str]:
    reasons = []
    ec = r.equity_curve
    if ec:
        if abs(ec[0].strategy - 1.0) > 1e-6:
            reasons.append(f"strategy not anchored at 1.0 (got {ec[0].strategy})")
        if abs(ec[0].benchmark - 1.0) > 1e-6:
            reasons.append(f"benchmark not anchored at 1.0 (got {ec[0].benchmark})")
    m = r.metrics
    # A fully-invested long-only book can read marginally over 100% gross: each
    # rebalance pays its cost out of cash, leaving cash slightly negative, so
    # gross = 1 - cash/equity ticks just above 1. Tolerate that sub-1% drift while
    # still catching real (leveraged) bugs.
    if not (0.0 <= m.avg_gross_exposure_pct <= 101.0):
        reasons.append(f"avg gross out of range: {m.avg_gross_exposure_pct}")
    if m.days <= 0:
        reasons.append(f"non-positive days: {m.days}")
    if r.common_window_start >= r.as_of_date:
        reasons.append("window start not before as_of (lookahead boundary broken)")
    return reasons


def _check(case, result: PortfolioResult | None, error, duration_ms) -> tuple[bool, list[str]]:
    a = case.get("assertions", {})
    if a.get("expect_failed"):
        if error is None:
            return False, ["expected failure but pipeline completed"]
        return True, []
    if error is not None:
        return False, [f"crashed: {type(error).__name__}: {error}"]
    assert result is not None
    reasons = _invariants(result)
    avail = {h.ticker for h in result.holdings if h.available}
    for d in (a.get("expect_dropped") or []):
        if d in avail:
            reasons.append(f"expected {d} dropped but it is available")
    if (mh := a.get("min_holdings")) is not None and len(avail) < mh:
        reasons.append(f"holdings {len(avail)} < min {mh}")
    if (mc := a.get("max_cost_usd")) is not None and result.cost_usd > mc:
        reasons.append(f"cost ${result.cost_usd:.4f} > ${mc}")
    if (md := a.get("max_duration_ms")) is not None and duration_ms > md:
        reasons.append(f"duration {duration_ms}ms > {md}ms")
    return (not reasons), reasons


async def _run_case(case: dict[str, Any]) -> CaseOutcome:
    error = None; result = None
    started = datetime.now(timezone.utc)
    try:
        result = await run_portfolio_pipeline(tickers=list(case["tickers"]), job_id=new_job_id())
    except Exception as e:  # noqa: BLE001
        error = e
    dur = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    passed, reasons = _check(case, result, error, dur)
    o = CaseOutcome(id=case["id"], category=case.get("category", "?"), tickers=list(case["tickers"]),
                    passed=passed, status=("failed" if error else "succeeded"),
                    duration_ms=dur, failure_reasons=reasons)
    if result:
        o.method = result.spec.method
        o.n_holdings = sum(1 for h in result.holdings if h.available)
        o.total_return_pct = result.metrics.total_return_pct
        o.excess_vs_basket_pct = result.metrics.excess_return_pct
        o.alpha_vs_market_pct = result.metrics.excess_vs_market_pct
        o.sharpe = result.metrics.sharpe
        o.cost_usd = result.cost_usd
    return o


async def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="task10_portfolio/eval/report.json")
    p.add_argument("--filter"); p.add_argument("--baseline")
    p.add_argument("--concurrency", type=int, default=1)  # each case is heavy (N×T4)
    args = p.parse_args(argv)

    configure_logging(); await init_db()
    cases = yaml.safe_load(EVAL_SET.read_text())["cases"]
    if args.filter:
        cases = [c for c in cases if args.filter in c["id"]]
    sem = asyncio.Semaphore(max(1, args.concurrency))

    async def _b(c):
        async with sem:
            logger.info("eval_case_start", case_id=c["id"], tickers=c["tickers"])
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
