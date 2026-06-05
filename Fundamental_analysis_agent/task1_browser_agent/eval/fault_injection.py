"""Eval-only fault injection — deterministically force recovery paths.

In production runs, the recovery loop only triggers when the agent makes a real
mistake. That means "recovery works" can only be proven by accident. This
module gives the eval harness the ability to deterministically corrupt the
agent's state at a chosen point so we can assert that the recovery mechanism
catches and repairs the corruption.

Production code calls `should_inject_locator_fault()` and (if True) substitutes
a known-bad locator. The fault is consumed after `attempts` triggers; on the
next attempt the agent runs unimpeded and the recovery succeeds — or fails
loudly.

No production code path writes to this registry. Only the eval runner does.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

FaultType = Literal["stale_locator"]


@dataclass
class _Fault:
    on_action: str | None             # match by action name (e.g. "type", "click", "extract")
    on_step: int | None               # OR match by step index (1-based)
    type: FaultType
    attempts: int                      # how many initial attempts to corrupt
    consumed: int = 0
    triggered_on_steps: list[int] = field(default_factory=list)

    def matches(self, *, step_index: int, action: str) -> bool:
        if self.on_step is not None:
            return self.on_step == step_index
        if self.on_action is not None:
            return self.on_action == action
        return False


_REGISTRY: dict[str, _Fault] = {}


def register(job_id: str, spec: dict) -> None:
    """Called once by the eval runner before AgentRunner.run()."""
    _REGISTRY[job_id] = _Fault(
        on_action=spec.get("on_action"),
        on_step=spec.get("on_step"),
        type=spec.get("type", "stale_locator"),
        attempts=int(spec.get("attempts", 1)),
    )


def should_inject_locator_fault(*, job_id: str, step_index: int, action: str) -> bool:
    """Called by the state machine after LOCATE. Returns True for at most
    `attempts` consecutive calls per matching step, then permanently False."""
    fault = _REGISTRY.get(job_id)
    if fault is None or fault.type != "stale_locator":
        return False
    if fault.consumed >= fault.attempts:
        return False
    if not fault.matches(step_index=step_index, action=action):
        return False
    fault.consumed += 1
    fault.triggered_on_steps.append(step_index)
    return True


def summary(job_id: str) -> dict | None:
    fault = _REGISTRY.get(job_id)
    if not fault:
        return None
    return {
        "type": fault.type,
        "configured_attempts": fault.attempts,
        "triggered_count": fault.consumed,
        "triggered_on_steps": list(fault.triggered_on_steps),
    }


def clear(job_id: str) -> None:
    _REGISTRY.pop(job_id, None)
