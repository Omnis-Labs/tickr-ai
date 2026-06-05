"""Eval metrics aggregation. Numbers reported here feed into the analysis report."""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean, median


@dataclass
class CaseOutcome:
    id: str
    category: str
    passed: bool
    status: str
    cost_usd: float
    duration_ms: int
    recovery_attempts: int
    failure_reason: str | None = None
    job_id: str | None = None  # link to /jobs/{job_id} inspector


@dataclass
class AggregateMetrics:
    n_cases: int
    n_pass: int
    n_infra_error: int            # provider-side outages, segregated
    pass_rate: float              # passed / all cases (including infra failures)
    pass_rate_ex_infra: float     # passed / (all cases - infra failures), the "honest" rate
    cost_p50: float
    cost_p95: float
    duration_p50_ms: float
    duration_p95_ms: float
    recovery_rate: float  # cases that recovered at least once and still passed
    by_category: dict[str, dict[str, float]] = field(default_factory=dict)

    @classmethod
    def from_outcomes(cls, outcomes: list[CaseOutcome]) -> AggregateMetrics:
        if not outcomes:
            return cls(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        passed = [o for o in outcomes if o.passed]
        infra = [o for o in outcomes if o.status == "infra_error"]
        # Cost/latency stats include only cases that actually ran (skip infra)
        scored = [o for o in outcomes if o.status != "infra_error"]
        costs = sorted(o.cost_usd for o in scored) or [0.0]
        durations = sorted(o.duration_ms for o in scored) or [0]
        recovered = [o for o in passed if o.recovery_attempts > 0]
        by_cat: dict[str, dict[str, float]] = {}
        cats = {o.category for o in outcomes}
        for c in cats:
            slc = [o for o in outcomes if o.category == c]
            by_cat[c] = {
                "n": len(slc),
                "pass_rate": sum(1 for o in slc if o.passed) / len(slc),
                "mean_cost_usd": mean(o.cost_usd for o in slc),
            }
        n_scored = max(1, len(outcomes) - len(infra))
        return cls(
            n_cases=len(outcomes),
            n_pass=len(passed),
            n_infra_error=len(infra),
            pass_rate=len(passed) / len(outcomes),
            pass_rate_ex_infra=len(passed) / n_scored,
            cost_p50=_percentile(costs, 50),
            cost_p95=_percentile(costs, 95),
            duration_p50_ms=_percentile(durations, 50),
            duration_p95_ms=_percentile(durations, 95),
            recovery_rate=(len(recovered) / max(1, len(passed))),
            by_category=by_cat,
        )


def _percentile(sorted_vals: list[float], p: int) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return float(sorted_vals[f])
    return float(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f))
