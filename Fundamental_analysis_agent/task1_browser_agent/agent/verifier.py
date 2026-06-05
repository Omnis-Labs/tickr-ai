"""Verifier — silent failure firewall.

ACT not raising an exception is NOT proof of success. The verifier compares the
post-action page state against the step's success_criteria and either passes
the step or labels a failure_kind for the diagnoser.
"""

from __future__ import annotations

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.schemas import FailureKind

from task1_browser_agent.agent.prompt_loader import render, split


async def verify(
    *,
    trace_id: str,
    success_criteria: str,
    current_url: str,
    visible_text: str,
    budget_usd: float,
) -> tuple[bool, str, FailureKind | None]:
    system, user_template = split("verifier")
    user = render(
        user_template,
        success_criteria=success_criteria,
        current_url=current_url,
        visible_text=visible_text[:1500],
    )
    resp = await LLMGateway.instance().call(
        LLMRequest(
            trace_id=trace_id,
            purpose="task1.verifier",
            tier=Tier.CHEAP,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=250,
            temperature=0.0,
            response_format="json",
            cache_system=True,
        ),
        trace_budget_usd=budget_usd,
    )
    data = resp.parsed_json or {}
    passed = bool(data.get("passed", False))
    reason = str(data.get("reason", ""))
    kind_str = data.get("failure_kind")
    kind: FailureKind | None = None
    if kind_str and not passed:
        try:
            kind = FailureKind(kind_str.lower())
        except ValueError:
            kind = FailureKind.UNKNOWN
    return passed, reason, kind
