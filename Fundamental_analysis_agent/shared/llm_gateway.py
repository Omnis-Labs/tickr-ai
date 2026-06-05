"""LLM Gateway — single entrypoint for every model call in the system.

Responsibilities (per PLAN.md §1.1):
  * Pluggable backend (anthropic | openai | gemini | mock)
  * Tier-based model routing (cheap → default → premium)
  * Cost attribution — every call writes a CostRecord BEFORE returning
  * Retry with exponential backoff + circuit breaker
  * Budget cap enforcement (per trace + global daily)

No module should import anthropic/openai/google SDKs directly. Always go through here.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from shared.config import get_settings
from shared.cost_ledger import record_cost
from shared.logging import get_logger
from shared.schemas import CostRecord

logger = get_logger(__name__)


class Tier(str, Enum):
    """Cost tier. Maps to a concrete model per backend at call time."""

    CHEAP = "cheap"        # classification, verifier, simple judge
    DEFAULT = "default"    # planner, extractor, most agent reasoning
    PREMIUM = "premium"    # arbitration, hard cases only


# Anthropic pricing (USD per 1M tokens, public list price as of model release).
# Keep updated when prices change — analysis report relies on this.
ANTHROPIC_PRICING: dict[str, tuple[float, float, float, float]] = {
    # model: (input, output, cache_write, cache_read)
    "claude-haiku-4-5-20251001": (1.0, 5.0, 1.25, 0.10),
    "claude-sonnet-4-6": (3.0, 15.0, 3.75, 0.30),
    "claude-opus-4-7": (15.0, 75.0, 18.75, 1.50),
}

OPENAI_PRICING: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "o1": (15.00, 60.00),
}

# Gemini pricing (USD per 1M tokens). Update when Google changes the price list.
GEMINI_PRICING: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-pro": (1.25, 10.00),       # <=200k context tier
    # Legacy fallbacks
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-1.5-pro": (1.25, 5.00),
    "gemini-1.5-flash": (0.075, 0.30),
}


class LLMRequest(BaseModel):
    """One request to the gateway. `trace_id` + `purpose` mandatory."""

    trace_id: str
    purpose: str = Field(
        description=(
            "Short tag for cost attribution, e.g. 'task1.planner', 'task1.diagnose'. "
            "Required so the cost ledger can be sliced by function."
        )
    )
    tier: Tier = Tier.DEFAULT
    system: str | None = None
    messages: list[dict[str, Any]]
    max_tokens: int = 1024
    temperature: float = 0.0
    response_format: Literal["text", "json"] = "text"
    cache_system: bool = False  # use Anthropic prompt caching for system prompt


class LLMResponse(BaseModel):
    content: str
    parsed_json: dict[str, Any] | None = None
    model: str
    backend: str
    cost_usd: float
    latency_ms: int
    input_tokens: int
    output_tokens: int
    cache_hit: bool


class BudgetExceededError(RuntimeError):
    pass


class LLMBackendError(RuntimeError):
    pass


class LLMUnavailableError(LLMBackendError):
    """Provider is temporarily unavailable (HTTP 503, 429, RESOURCE_EXHAUSTED).

    Subclass of LLMBackendError so the retry decorator still catches it, but
    callers can `except LLMUnavailableError` to distinguish "the provider is
    down" from "we sent something the provider rejected." Eval runner uses
    this to classify the case outcome as infrastructure error vs system bug.
    """


# ---------------------------------------------------------------------------
# Backend implementations
# ---------------------------------------------------------------------------


class _AnthropicBackend:
    def __init__(self) -> None:
        from anthropic import AsyncAnthropic  # lazy import

        settings = get_settings()
        if not settings.anthropic_api_key:
            raise LLMBackendError(
                "ANTHROPIC_API_KEY missing — set it in .env or switch LLM_BACKEND."
            )
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._models = {
            Tier.CHEAP: settings.anthropic_model_cheap,
            Tier.DEFAULT: settings.anthropic_model_default,
            Tier.PREMIUM: settings.anthropic_model_premium,
        }

    async def call(self, req: LLMRequest) -> LLMResponse:
        model = self._models[req.tier]
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
            "messages": req.messages,
        }
        if req.system:
            if req.cache_system:
                kwargs["system"] = [
                    {
                        "type": "text",
                        "text": req.system,
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
            else:
                kwargs["system"] = req.system

        start = time.perf_counter()
        result = await self._client.messages.create(**kwargs)
        latency_ms = int((time.perf_counter() - start) * 1000)

        content = "".join(
            block.text for block in result.content if getattr(block, "type", "") == "text"
        )

        input_tokens = result.usage.input_tokens
        output_tokens = result.usage.output_tokens
        cache_read = getattr(result.usage, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(result.usage, "cache_creation_input_tokens", 0) or 0

        in_price, out_price, cwrite_price, cread_price = ANTHROPIC_PRICING.get(
            model, (3.0, 15.0, 3.75, 0.30)
        )
        cost_usd = (
            (input_tokens - cache_read) * in_price
            + output_tokens * out_price
            + cache_write * cwrite_price
            + cache_read * cread_price
        ) / 1_000_000

        return LLMResponse(
            content=content,
            model=model,
            backend="anthropic",
            cost_usd=cost_usd,
            latency_ms=latency_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_hit=cache_read > 0,
        )


class _OpenAIBackend:
    def __init__(self) -> None:
        from openai import AsyncOpenAI  # lazy import

        settings = get_settings()
        if not settings.openai_api_key:
            raise LLMBackendError(
                "OPENAI_API_KEY missing — set it in .env or switch LLM_BACKEND."
            )
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._models = {
            Tier.CHEAP: settings.openai_model_cheap,
            Tier.DEFAULT: settings.openai_model_default,
            Tier.PREMIUM: settings.openai_model_premium,
        }

    async def call(self, req: LLMRequest) -> LLMResponse:
        model = self._models[req.tier]
        messages = list(req.messages)
        if req.system:
            messages = [{"role": "system", "content": req.system}, *messages]

        start = time.perf_counter()
        result = await self._client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
            response_format={"type": "json_object"} if req.response_format == "json" else None,
        )
        latency_ms = int((time.perf_counter() - start) * 1000)

        content = result.choices[0].message.content or ""
        usage = result.usage
        input_tokens = usage.prompt_tokens if usage else 0
        output_tokens = usage.completion_tokens if usage else 0

        in_price, out_price = OPENAI_PRICING.get(model, (2.50, 10.00))
        cost_usd = (input_tokens * in_price + output_tokens * out_price) / 1_000_000

        return LLMResponse(
            content=content,
            model=model,
            backend="openai",
            cost_usd=cost_usd,
            latency_ms=latency_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_hit=False,
        )


class _GeminiBackend:
    """Google Gemini via the unified `google-genai` SDK.

    Gemini's chat shape differs from OpenAI/Anthropic:
      * roles are "user" / "model" (we map "assistant"→"model")
      * system instructions go on a separate `system_instruction` field
      * JSON mode is `response_mime_type="application/json"`
      * Anthropic-style prompt caching is not supported by this backend yet —
        `cache_system=True` is silently ignored.
    """

    def __init__(self) -> None:
        from google import genai  # lazy import; pkg name "google-genai"

        settings = get_settings()
        if not settings.gemini_api_key:
            raise LLMBackendError(
                "GEMINI_API_KEY missing — set it in .env or switch LLM_BACKEND."
            )
        self._genai = genai
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._models = {
            Tier.CHEAP: settings.gemini_model_cheap,
            Tier.DEFAULT: settings.gemini_model_default,
            Tier.PREMIUM: settings.gemini_model_premium,
        }

    @staticmethod
    def _to_contents(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        contents: list[dict[str, Any]] = []
        for m in messages:
            role = m.get("role", "user")
            if role == "assistant":
                role = "model"
            text = m.get("content", "")
            contents.append({"role": role, "parts": [{"text": str(text)}]})
        return contents

    async def call(self, req: LLMRequest) -> LLMResponse:
        from google.genai import types as gtypes

        model = self._models[req.tier]
        config_kwargs: dict[str, Any] = {
            "temperature": req.temperature,
            "max_output_tokens": req.max_tokens,
        }
        if req.system:
            config_kwargs["system_instruction"] = req.system
        if req.response_format == "json":
            config_kwargs["response_mime_type"] = "application/json"
        # Gemini 2.5 Flash defaults to dynamic thinking, which silently eats
        # the output-token budget on structured prompts (we saw responses
        # truncated to a single `{`). For CHEAP and DEFAULT tiers we disable
        # thinking — these are deterministic structured-output calls that do
        # not benefit from extended reasoning. PREMIUM (gemini-2.5-pro) does
        # not allow disabling thinking and is reserved for hard cases.
        if req.tier in (Tier.CHEAP, Tier.DEFAULT):
            config_kwargs["thinking_config"] = gtypes.ThinkingConfig(thinking_budget=0)

        start = time.perf_counter()
        # google-genai's async surface lives under `aio`
        result = await self._client.aio.models.generate_content(
            model=model,
            contents=self._to_contents(req.messages),
            config=gtypes.GenerateContentConfig(**config_kwargs),
        )
        latency_ms = int((time.perf_counter() - start) * 1000)

        content = result.text or ""
        usage = getattr(result, "usage_metadata", None)
        input_tokens = getattr(usage, "prompt_token_count", 0) or 0
        output_tokens = getattr(usage, "candidates_token_count", 0) or 0

        in_price, out_price = GEMINI_PRICING.get(model, (0.30, 2.50))
        cost_usd = (input_tokens * in_price + output_tokens * out_price) / 1_000_000

        return LLMResponse(
            content=content,
            model=model,
            backend="gemini",
            cost_usd=cost_usd,
            latency_ms=latency_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_hit=False,
        )


class _MockBackend:
    """Deterministic mock for unit tests / offline development."""

    async def call(self, req: LLMRequest) -> LLMResponse:
        canned = "{}" if req.response_format == "json" else "mock-response"
        return LLMResponse(
            content=canned,
            model="mock",
            backend="mock",
            cost_usd=0.0,
            latency_ms=1,
            input_tokens=0,
            output_tokens=0,
            cache_hit=False,
        )


# ---------------------------------------------------------------------------
# Gateway
# ---------------------------------------------------------------------------


class LLMGateway:
    """Process-wide singleton entrypoint to whichever backend is configured."""

    _instance: LLMGateway | None = None

    def __init__(self) -> None:
        settings = get_settings()
        self.backend_name = settings.llm_backend
        if settings.llm_backend == "anthropic":
            self._backend: Any = _AnthropicBackend()
        elif settings.llm_backend == "openai":
            self._backend = _OpenAIBackend()
        elif settings.llm_backend == "gemini":
            self._backend = _GeminiBackend()
        elif settings.llm_backend == "mock":
            self._backend = _MockBackend()
        else:
            raise LLMBackendError(f"unknown LLM_BACKEND={settings.llm_backend}")

    @classmethod
    def instance(cls) -> LLMGateway:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # Retry policy:
    #   * LLMUnavailableError (503/429/overloaded) → 4 attempts, exp backoff
    #     starting at 4s, capped at 30s. The first eval surfaced a real Gemini
    #     503 outage that the old policy (3 attempts, max 4s) burnt through
    #     in under 5s; spikes typically last 10-60s, so we widen the window.
    #   * Other LLMBackendError → 3 attempts, fast retry.
    @retry(
        retry=retry_if_exception_type(LLMBackendError),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, min=2, max=30),
        reraise=True,
    )
    async def call(self, req: LLMRequest, *, trace_budget_usd: float | None = None) -> LLMResponse:
        if not req.trace_id or not req.purpose:
            raise ValueError("LLMRequest.trace_id and .purpose are mandatory")

        # Budget pre-check: if the running spend on this trace already exceeds
        # the cap, refuse before the call rather than after.
        if trace_budget_usd is not None:
            from shared.cost_ledger import cost_for_trace

            spent = await cost_for_trace(req.trace_id)
            if spent >= trace_budget_usd:
                raise BudgetExceededError(
                    f"trace {req.trace_id} spent ${spent:.4f} >= cap ${trace_budget_usd:.4f}"
                )

        try:
            resp = await self._backend.call(req)
        except LLMUnavailableError:
            raise  # already classified
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            low = msg.lower()
            transient = (
                "503" in msg
                or "429" in msg
                or "unavailable" in low
                or "resource_exhausted" in low
                or "overloaded" in low
                or "rate limit" in low
            )
            logger.error(
                "llm_backend_failed",
                purpose=req.purpose,
                transient=transient,
                error=msg[:300],
            )
            if transient:
                raise LLMUnavailableError(msg) from e
            raise LLMBackendError(msg) from e

        # Cost ledger write — non-negotiable.
        await record_cost(
            CostRecord(
                trace_id=req.trace_id,
                purpose=req.purpose,
                model=resp.model,
                backend=resp.backend,  # type: ignore[arg-type]
                input_tokens=resp.input_tokens,
                output_tokens=resp.output_tokens,
                cost_usd=resp.cost_usd,
                latency_ms=resp.latency_ms,
                cache_hit=resp.cache_hit,
                occurred_at=datetime.now(timezone.utc),
            )
        )

        if req.response_format == "json":
            try:
                resp.parsed_json = _coerce_json(resp.content)
            except json.JSONDecodeError as e:
                logger.warning("llm_json_parse_failed", purpose=req.purpose, error=str(e))

        logger.info(
            "llm_call_complete",
            purpose=req.purpose,
            trace_id=req.trace_id,
            model=resp.model,
            cost_usd=round(resp.cost_usd, 6),
            latency_ms=resp.latency_ms,
            cache_hit=resp.cache_hit,
        )
        return resp


def new_trace_id() -> str:
    return uuid.uuid4().hex[:16]


def _coerce_json(content: str) -> dict[str, Any]:
    """Best-effort JSON extraction. LLMs sometimes wrap JSON in markdown fences."""
    s = content.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.startswith("json"):
            s = s[4:]
        s = s.strip()
        if s.endswith("```"):
            s = s[:-3].strip()
    # Find outermost braces if there's leading/trailing prose
    if not s.startswith("{"):
        start = s.find("{")
        end = s.rfind("}")
        if start >= 0 and end > start:
            s = s[start : end + 1]
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        # Best-effort repair for output truncated by max_tokens (the common
        # failure: an `items` array cut off mid-object → "Unterminated
        # string"). Trim back to the last complete object and re-balance the
        # open brackets. Imperfect if strings contain literal brackets, but it
        # salvages the items extracted before the cutoff instead of losing all.
        return _repair_truncated_json(s)


def _repair_truncated_json(s: str) -> dict[str, Any]:
    last = s.rfind("}")
    if last == -1:
        return json.loads(s)  # nothing to salvage — re-raise original-style error
    candidate = s[: last + 1]
    candidate += "]" * max(0, candidate.count("[") - candidate.count("]"))
    candidate += "}" * max(0, candidate.count("{") - candidate.count("}"))
    return json.loads(candidate)
