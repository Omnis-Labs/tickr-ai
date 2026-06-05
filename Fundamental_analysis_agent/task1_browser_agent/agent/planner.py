"""Planner — natural language task → ordered list of PlannedStep."""

from __future__ import annotations

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.schemas import ActionType, Locator, PlannedStep

from task1_browser_agent.agent.prompt_loader import render, split


class PlanRefusedError(RuntimeError):
    """Raised when the planner refuses the task (out of scope, requires auth, etc)."""


async def make_plan(
    *,
    trace_id: str,
    task_description: str,
    allowed_domains: list[str],
    budget_usd: float,
) -> tuple[str | None, list[PlannedStep]]:
    """Return (target_url, plan). Raises PlanRefusedError if planner refused."""
    system, user_template = split("planner")
    user = render(
        user_template,
        task_description=task_description,
        allowed_domains=", ".join(allowed_domains) if allowed_domains else "(no restriction)",
    )
    resp = await LLMGateway.instance().call(
        LLMRequest(
            trace_id=trace_id,
            purpose="task1.planner",
            tier=Tier.DEFAULT,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=1500,
            temperature=0.0,
            response_format="json",
            cache_system=True,
        ),
        trace_budget_usd=budget_usd,
    )
    data = resp.parsed_json or {}
    if data.get("refuse"):
        raise PlanRefusedError(data.get("reason", "Planner refused without reason"))

    raw_steps = data.get("steps", [])
    plan: list[PlannedStep] = []
    for i, raw in enumerate(raw_steps, start=1):
        plan.append(
            PlannedStep(
                index=raw.get("index", i),
                action=ActionType(raw["action"]),
                target_description=raw.get("target_description", ""),
                value=raw.get("value"),
                success_criteria=raw.get("success_criteria", ""),
                locator=None,  # filled later in LOCATE stage
            )
        )
    return data.get("target_url"), plan
