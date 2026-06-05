"""Diagnoser — classify failure root cause + pick a recovery strategy.

The diagnoser is the difference between "self-correction" and "try/except retry".
It is required to articulate WHAT changes on retry; otherwise it must ESCALATE.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.schemas import FailureKind, StepResult

from task1_browser_agent.agent.prompt_loader import render, split


class RecoveryStrategy(str, Enum):
    RELOCATE = "RELOCATE"
    WAIT_AND_RETRY = "WAIT_AND_RETRY"
    REPLAN_FROM_STEP = "REPLAN_FROM_STEP"
    ESCALATE = "ESCALATE"
    ABORT = "ABORT"


class Diagnosis(BaseModel):
    failure_kind: FailureKind
    root_cause: str
    recovery_strategy: RecoveryStrategy
    parameters: dict[str, Any] = {}


def _format_recent(recent: list[StepResult]) -> str:
    if not recent:
        return "(none — this is step 1)"
    lines = []
    for s in recent[-3:]:
        lines.append(
            f"- step {s.step_index} state={s.state.value} "
            f"success={s.success} failure={s.failure_kind.value if s.failure_kind else '-'}: "
            f"{s.error_message or 'ok'}"
        )
    return "\n".join(lines)


async def diagnose(
    *,
    trace_id: str,
    step_index: int,
    action: str,
    target_description: str,
    success_criteria: str,
    verifier_reason: str,
    verifier_kind: FailureKind | None,
    recent_steps: list[StepResult],
    dom_excerpt: str,
    recovery_remaining: int,
    recovery_max: int,
    budget_usd: float,
) -> Diagnosis:
    system, user_template = split("diagnoser")
    user = render(
        user_template,
        step_index=step_index,
        action=action,
        target_description=target_description,
        success_criteria=success_criteria,
        verifier_reason=verifier_reason,
        verifier_kind=verifier_kind.value if verifier_kind else "unknown",
        recent_steps=_format_recent(recent_steps),
        dom_excerpt=dom_excerpt[:3000],
        recovery_remaining=recovery_remaining,
        recovery_max=recovery_max,
    )
    resp = await LLMGateway.instance().call(
        LLMRequest(
            trace_id=trace_id,
            purpose="task1.diagnoser",
            tier=Tier.DEFAULT,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=400,
            temperature=0.0,
            response_format="json",
            cache_system=True,
        ),
        trace_budget_usd=budget_usd,
    )
    data = resp.parsed_json or {}
    try:
        kind = FailureKind(str(data.get("failure_kind", "unknown")).lower())
    except ValueError:
        kind = FailureKind.UNKNOWN
    try:
        strategy = RecoveryStrategy(str(data.get("recovery_strategy", "ESCALATE")).upper())
    except ValueError:
        strategy = RecoveryStrategy.ESCALATE
    return Diagnosis(
        failure_kind=kind,
        root_cause=str(data.get("root_cause", "unspecified")),
        recovery_strategy=strategy,
        parameters=data.get("parameters") or {},
    )
