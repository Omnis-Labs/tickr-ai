"""Task 1 — Browser Agent state machine.

States: PLAN → LOCATE → ACT → VERIFY → DONE / REPLAN / ESCALATE
                ↑          │ fail
                └ DIAGNOSE ←┘

Implemented explicitly (not ReAct) so each transition can be unit-tested and
each failure has a single owner. See docs/adr/ADR-001-state-machine-over-react.md.

The state machine yields `Task1StepEvent` as it progresses — these go straight
to SSE for the live frontend.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from shared.config import get_settings
from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from shared.schemas import (
    ActionType,
    AgentState,
    FailureKind,
    JobStatus,
    PlannedStep,
    StepResult,
    Task1Job,
    Task1StepEvent,
)

from task1_browser_agent.agent.diagnoser import (
    Diagnosis,
    RecoveryStrategy,
    diagnose,
)
from task1_browser_agent.agent.executor import BrowserExecutor, PageSnapshot
from task1_browser_agent.agent.locator import resolve_locator
from task1_browser_agent.agent.planner import PlanRefusedError, make_plan
from task1_browser_agent.agent.verifier import verify

logger = get_logger(__name__)


def _signature(target_description: str) -> str:
    """Normalize an NL target description for selector_history lookup.

    Two descriptions with the same intent should hit the same row even if
    capitalization or filler words differ. We lower-case + collapse
    whitespace + drop the most common filler words.
    """
    import re

    s = (target_description or "").lower()
    s = re.sub(r"\b(the|a|an|of|on|at|in|to)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:200]  # cap for DB column width


class AgentRunner:
    """One agent run = one job. Yields events for SSE; mutates the Task1Job in place."""

    def __init__(self, job: Task1Job) -> None:
        self.job = job
        self.settings = get_settings()
        self._sequence = 0
        self._final_output: dict[str, Any] = {}

    def _event(
        self,
        state: AgentState,
        message: str,
        *,
        step_index: int | None = None,
        detail: dict[str, Any] | None = None,
    ) -> Task1StepEvent:
        self._sequence += 1
        return Task1StepEvent(
            job_id=self.job.job_id,
            sequence=self._sequence,
            state=state,
            step_index=step_index,
            message=message,
            detail=detail,
            timestamp=datetime.now(timezone.utc),
        )

    async def run(self) -> AsyncIterator[Task1StepEvent]:
        budget = self.settings.task1_budget_usd
        max_recovery = self.settings.task1_max_recovery_attempts
        max_steps = self.settings.task1_max_steps

        self.job.status = JobStatus.RUNNING
        self.job.updated_at = datetime.now(timezone.utc)
        yield self._event(AgentState.PLAN, "Planning task")

        # ----- PLAN -------------------------------------------------------
        try:
            target_url, plan = await make_plan(
                trace_id=self.job.job_id,
                task_description=self.job.task_description,
                allowed_domains=self.settings.allowed_domains,
                budget_usd=budget,
            )
        except PlanRefusedError as e:
            self.job.status = JobStatus.ESCALATED
            self.job.updated_at = datetime.now(timezone.utc)
            yield self._event(
                AgentState.ESCALATE,
                f"Planner refused: {e}",
                detail={"reason": str(e)},
            )
            return

        self.job.target_url = target_url
        self.job.plan = plan
        yield self._event(
            AgentState.PLAN,
            f"Planned {len(plan)} step(s)",
            detail={"plan": [s.model_dump() for s in plan], "target_url": target_url},
        )

        if not plan:
            self.job.status = JobStatus.FAILED
            yield self._event(AgentState.ESCALATE, "Empty plan")
            return
        if len(plan) > max_steps:
            self.job.status = JobStatus.ESCALATED
            yield self._event(
                AgentState.ESCALATE, f"Plan length {len(plan)} exceeds max {max_steps}"
            )
            return

        # ----- EXECUTE loop ----------------------------------------------
        async with BrowserExecutor(job_id=self.job.job_id) as ex:
            i = 0
            while i < len(plan):
                step = plan[i]
                async for ev in self._run_one_step(ex, step, max_recovery, budget):
                    yield ev
                last = self.job.steps[-1] if self.job.steps else None
                if last and not last.success:
                    # _run_one_step has already set the terminal status or
                    # produced a REPLAN. Decide what to do next.
                    if self.job.status in (JobStatus.FAILED, JobStatus.ESCALATED):
                        return
                    if self._replan_target is not None:
                        i = self._replan_target - 1  # 0-indexed
                        self._replan_target = None
                        continue
                i += 1

        # ----- FINAL ------------------------------------------------------
        self.job.total_cost_usd = await cost_for_trace(self.job.job_id)
        self.job.status = JobStatus.SUCCEEDED
        self.job.final_output = self._final_output
        self.job.updated_at = datetime.now(timezone.utc)
        yield self._event(
            AgentState.DONE,
            "Task completed",
            detail={"output": self._final_output, "cost_usd": self.job.total_cost_usd},
        )

    _replan_target: int | None = None

    async def _run_one_step(
        self,
        ex: BrowserExecutor,
        step: PlannedStep,
        max_recovery: int,
        budget: float,
    ) -> AsyncIterator[Task1StepEvent]:
        """Run LOCATE → ACT → VERIFY (with DIAGNOSE on fail) for one step."""
        attempt = 0
        prefer_semantic = False
        prefer_visual = False
        # Locators that have already produced a STALE_SELECTOR result for THIS step.
        # We feed these back into the locator prompt so it cannot just re-emit the
        # same broken selector (the most common failure mode in the first eval).
        failed_primary_selectors: list[str] = []

        while True:
            attempt += 1
            started = datetime.now(timezone.utc)

            # ----- LOCATE ----------------------------------------------
            if step.action in (
                ActionType.CLICK,
                ActionType.TYPE,
                ActionType.SELECT,
                ActionType.EXTRACT,
            ):
                yield self._event(
                    AgentState.LOCATE,
                    f"Locating: {step.target_description}",
                    step_index=step.index,
                )
                snap = await ex.snapshot(step_index=step.index)
                # Pull known-good selectors from selector_history for this
                # (site, target) — first-try hit rate compounds over time.
                from shared.cost_ledger import get_known_good_selectors
                from urllib.parse import urlparse
                site_host = (urlparse(snap.url).hostname or "").lower()
                target_sig = _signature(step.target_description)
                known_good = await get_known_good_selectors(
                    site_host=site_host, target_signature=target_sig
                )
                step.locator = await resolve_locator(
                    trace_id=self.job.job_id,
                    target_description=step.target_description,
                    dom_excerpt=snap.dom_excerpt,
                    a11y_tree=snap.a11y_tree,
                    budget_usd=budget,
                    prefer_semantic=prefer_semantic,
                    prefer_visual=prefer_visual,
                    avoid_selectors=failed_primary_selectors,
                    known_good=known_good,
                )
                # Stash the site_host + signature for later success/failure
                # writes — we don't want to re-snapshot the page in DIAGNOSE.
                self._last_site_host = site_host
                self._last_target_sig = target_sig

                # Eval-only: deterministically corrupt the locator so the
                # recovery loop must engage. No-op in production (no fault
                # registered for this job_id).
                from task1_browser_agent.eval.fault_injection import (
                    should_inject_locator_fault,
                )
                if should_inject_locator_fault(
                    job_id=self.job.job_id,
                    step_index=step.index,
                    action=step.action.value,
                ):
                    from shared.schemas import Locator
                    step.locator = Locator(
                        primary="div#__fault_injected_does_not_exist__",
                        notes="fault-injected by eval harness",
                    )
                    yield self._event(
                        AgentState.LOCATE,
                        "Fault-injected: locator corrupted to force recovery",
                        step_index=step.index,
                        detail={"fault": "stale_locator"},
                    )

            # ----- ACT -------------------------------------------------
            yield self._event(
                AgentState.ACT,
                f"{step.action.value}: {step.target_description or step.value or ''}",
                step_index=step.index,
            )
            failure_kind, err, output = await ex.execute(step)

            # Wait briefly for any post-action navigation/render before verifying
            try:
                await ex.page.wait_for_load_state("domcontentloaded", timeout=3000)
            except Exception:  # noqa: BLE001
                pass

            post = await ex.snapshot(step_index=step.index)

            if failure_kind is None:
                # ----- VERIFY -----------------------------------------
                if step.success_criteria:
                    yield self._event(
                        AgentState.VERIFY,
                        "Verifying success criteria",
                        step_index=step.index,
                    )
                    passed, reason, vk = await verify(
                        trace_id=self.job.job_id,
                        success_criteria=step.success_criteria,
                        current_url=post.url,
                        visible_text=post.visible_text,
                        budget_usd=budget,
                    )
                    if not passed:
                        failure_kind = vk or FailureKind.UNKNOWN
                        err = reason

            ended = datetime.now(timezone.utc)
            duration_ms = int((ended - started).total_seconds() * 1000)
            step_cost = await cost_for_trace(self.job.job_id)

            success = failure_kind is None
            result = StepResult(
                step_index=step.index,
                state=AgentState.ACT if success else AgentState.DIAGNOSE,
                success=success,
                failure_kind=failure_kind,
                error_message=err,
                dom_snapshot_ref=post.dom_snapshot_ref,
                screenshot_ref=post.screenshot_ref,
                duration_ms=duration_ms,
                cost_usd=step_cost,
                started_at=started,
                ended_at=ended,
            )
            self.job.steps.append(result)

            if success:
                if output.get("extracted_text"):
                    self._final_output[f"step_{step.index}"] = output["extracted_text"]
                # selector_history write: bump success_count for the locator
                # that worked. This compounds over time → future runs prefer
                # this selector and skip the locator-LLM call when it still
                # matches the DOM.
                if step.locator and (step.locator.primary or step.locator.semantic_role):
                    from shared.cost_ledger import record_selector_success
                    await record_selector_success(
                        site_host=getattr(self, "_last_site_host", ""),
                        target_signature=getattr(self, "_last_target_sig", ""),
                        primary_selector=step.locator.primary,
                        semantic_role=step.locator.semantic_role,
                        semantic_name=step.locator.semantic_name,
                    )
                yield self._event(
                    AgentState.VERIFY,
                    "Step passed",
                    step_index=step.index,
                    detail={"output": output},
                )
                return

            # ----- DIAGNOSE -------------------------------------------
            yield self._event(
                AgentState.DIAGNOSE,
                f"Step failed: {err}",
                step_index=step.index,
                detail={"failure_kind": failure_kind.value if failure_kind else None},
            )

            if self.job.recovery_attempts >= max_recovery:
                self.job.status = JobStatus.ESCALATED
                yield self._event(
                    AgentState.ESCALATE,
                    f"Recovery budget exhausted ({max_recovery} attempts)",
                    step_index=step.index,
                )
                return

            self.job.recovery_attempts += 1
            diag = await diagnose(
                trace_id=self.job.job_id,
                step_index=step.index,
                action=step.action.value,
                target_description=step.target_description,
                success_criteria=step.success_criteria,
                verifier_reason=err or "",
                verifier_kind=failure_kind,
                recent_steps=self.job.steps,
                dom_excerpt=post.dom_excerpt,
                recovery_remaining=max_recovery - self.job.recovery_attempts,
                recovery_max=max_recovery,
                budget_usd=budget,
            )
            yield self._event(
                AgentState.DIAGNOSE,
                f"Diagnosis: {diag.root_cause}",
                step_index=step.index,
                detail=diag.model_dump(mode="json"),
            )

            decision = self._apply_diagnosis(diag, step)
            if decision == "retry":
                # Record the selector that just failed so the next LOCATE prompt
                # is told not to re-propose it.
                if step.locator and step.locator.primary:
                    failed_primary_selectors.append(step.locator.primary)
                    # Persist failure to selector_history — drift detection
                    # signal: failure_count climbing on a selector that used
                    # to work tells us the site changed.
                    if failure_kind == FailureKind.STALE_SELECTOR:
                        from shared.cost_ledger import record_selector_failure
                        await record_selector_failure(
                            site_host=getattr(self, "_last_site_host", ""),
                            target_signature=getattr(self, "_last_target_sig", ""),
                            primary_selector=step.locator.primary,
                        )
                # Escalate the locator prong on each successive retry:
                #   attempt 1 fail → prefer_semantic
                #   attempt 2 fail → prefer_visual (give up on primary AND semantic)
                if prefer_visual:
                    pass  # already at the last prong; the loop will hit budget cap
                elif prefer_semantic or diag.parameters.get("prefer") == "visual":
                    prefer_visual = True
                    prefer_semantic = False
                else:
                    prefer_semantic = (
                        diag.parameters.get("prefer") == "semantic" or attempt >= 1
                    )
                continue
            if decision == "replan":
                self._replan_target = int(diag.parameters.get("replan_from", step.index))
                return
            # escalate or abort
            self.job.status = JobStatus.ESCALATED
            yield self._event(
                AgentState.ESCALATE,
                f"Escalating: {diag.recovery_strategy.value} — {diag.root_cause}",
                step_index=step.index,
                detail=diag.model_dump(mode="json"),
            )
            return

    def _apply_diagnosis(self, diag: Diagnosis, step: PlannedStep) -> str:
        if diag.recovery_strategy == RecoveryStrategy.RELOCATE:
            step.locator = None  # force re-resolve
            return "retry"
        if diag.recovery_strategy == RecoveryStrategy.WAIT_AND_RETRY:
            return "retry"
        if diag.recovery_strategy == RecoveryStrategy.REPLAN_FROM_STEP:
            return "replan"
        return "escalate"
