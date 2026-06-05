"""Strongly-typed contracts for all cross-module data.

Every output that crosses a process or storage boundary must be one of these.
Breaking changes go through a new version (e.g., Task1JobV2). Never silently
mutate field semantics.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------


class ArtifactRef(BaseModel):
    """Pointer to a binary artifact (DOM snapshot, screenshot, raw HTML)."""

    key: str
    content_type: str
    size_bytes: int
    created_at: datetime


class CostRecord(BaseModel):
    """One LLM call. Every call MUST produce one of these — no untraced spend."""

    trace_id: str
    purpose: str
    model: str
    backend: Literal["anthropic", "openai", "gemini", "mock"]
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float
    latency_ms: int
    cache_hit: bool = False
    occurred_at: datetime


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    ESCALATED = "escalated"  # exceeded budget / recovery attempts / safety wall
    QUARANTINED = "quarantined"  # output exists but confidence below threshold


# ---------------------------------------------------------------------------
# Task 1 — Browser Agent
# ---------------------------------------------------------------------------


class AgentState(str, Enum):
    PLAN = "PLAN"
    LOCATE = "LOCATE"
    ACT = "ACT"
    VERIFY = "VERIFY"
    DIAGNOSE = "DIAGNOSE"
    DONE = "DONE"
    ESCALATE = "ESCALATE"


class ActionType(str, Enum):
    NAVIGATE = "navigate"
    CLICK = "click"
    TYPE = "type"
    SELECT = "select"
    SCROLL = "scroll"
    WAIT = "wait"
    EXTRACT = "extract"  # read text / attribute, terminal


class FailureKind(str, Enum):
    STALE_SELECTOR = "stale_selector"
    PAGE_NOT_LOADED = "page_not_loaded"
    WRONG_STATE = "wrong_state"
    CAPTCHA_OR_AUTH = "captcha_or_auth"
    RATE_LIMITED = "rate_limited"
    INTENT_MISUNDERSTOOD = "intent_misunderstood"
    NAVIGATION_BLOCKED = "navigation_blocked"  # domain allow-list rejection
    BUDGET_EXCEEDED = "budget_exceeded"
    UNKNOWN = "unknown"


class Locator(BaseModel):
    """Three-pronged locator. Any surviving prong is enough to find the element."""

    primary: str | None = None        # CSS or XPath
    semantic_role: str | None = None  # ARIA role
    semantic_name: str | None = None  # accessible name
    visual_text: str | None = None    # visible text fallback
    notes: str | None = None


class PlannedStep(BaseModel):
    """One step in the agent's plan. Concrete enough to be executable."""

    index: int
    action: ActionType
    target_description: str           # NL description, fed to locator
    locator: Locator | None = None    # filled in by LOCATE state
    value: str | None = None          # for TYPE / SELECT / NAVIGATE
    success_criteria: str             # NL, fed to verifier


class StepResult(BaseModel):
    step_index: int
    state: AgentState
    success: bool
    failure_kind: FailureKind | None = None
    error_message: str | None = None
    dom_snapshot_ref: ArtifactRef | None = None
    screenshot_ref: ArtifactRef | None = None
    duration_ms: int
    cost_usd: float
    started_at: datetime
    ended_at: datetime


class Task1Job(BaseModel):
    job_id: str
    task_description: str            # the NL task from the user
    target_url: str | None = None
    status: JobStatus
    final_output: dict[str, Any] | None = None
    steps: list[StepResult] = Field(default_factory=list)
    plan: list[PlannedStep] = Field(default_factory=list)
    recovery_attempts: int = 0
    total_cost_usd: float = 0.0
    schema_version: Literal["1.0.0"] = "1.0.0"
    created_at: datetime
    updated_at: datetime


class Task1StepEvent(BaseModel):
    """SSE event payload streamed to the frontend during execution."""

    job_id: str
    sequence: int
    state: AgentState
    step_index: int | None = None
    message: str
    detail: dict[str, Any] | None = None
    timestamp: datetime


# ---------------------------------------------------------------------------
# Task 2 — placeholder, fleshed out when Task 2 work starts
# ---------------------------------------------------------------------------


class FilingMeta(BaseModel):
    cik: str | None = None
    accession_number: str | None = None
    fiscal_year: int | None = None
    form_type: Literal["10-K"] = "10-K"
    company_name: str | None = None
    source_url: str
    fetched_at: datetime


# Canonical Item IDs per SEC 10-K specification (Form 10-K, 2024 revision).
# We accept any of these; missing items are allowed (some filers skip e.g. 4, 6).
TEN_K_ITEM_IDS: list[str] = [
    "1", "1A", "1B", "1C",      # Part I
    "2", "3", "4",
    "5", "6", "7", "7A", "8",   # Part II
    "9", "9A", "9B", "9C",
    "10", "11", "12", "13", "14",  # Part III
    "15", "16",                  # Part IV
]


class ExtractedItem(BaseModel):
    item_id: str                       # one of TEN_K_ITEM_IDS
    title: str                         # SEC canonical title (e.g. "Risk Factors")
    content: str                       # extracted body text
    start_offset: int                  # 0-based char offset in normalized text
    end_offset: int                    # exclusive
    char_length: int                   # convenience: end - start
    confidence: float                  # calibrated [0,1]
    extraction_method: Literal["L1", "L2", "L3"]
    notes: str | None = None
    # True when the item's substantive content legitimately lives elsewhere
    # (e.g. Item 8 financials incorporated by reference into Item 15, or
    # Part III items deferred to the proxy statement). A short body for such
    # an item is CORRECT, not a truncation, so the quarantine gate must not
    # penalise it. Set by the recovery stage when an explicit reference phrase
    # is detected near the item.
    incorporated_by_reference: bool = False
    schema_version: Literal["1.0.0"] = "1.0.0"


class FilingExtraction(BaseModel):
    """Top-level result returned to the caller. Job-level."""

    job_id: str
    filing: FilingMeta
    items: list[ExtractedItem]
    overall_confidence: float          # calibrated [0,1], min(item.confidence) by default
    quarantined: bool                  # True if overall_confidence < threshold
    quarantine_reasons: list[str]
    extraction_method_summary: dict[str, int]  # {"L1": 12, "L2": 0, "L3": 0}
    n_expected_items: int              # baseline: len(TEN_K_ITEM_IDS) - allowed skips
    n_found_items: int
    coverage_ratio: float              # n_found / n_expected
    cost_usd: float                    # ledger spend for this job
    duration_ms: int
    schema_version: Literal["1.0.0"] = "1.0.0"
    created_at: datetime


class Task2Job(BaseModel):
    """In-flight tracking record. Mirrors Task1Job pattern."""

    job_id: str
    source_url: str
    status: JobStatus
    extraction: FilingExtraction | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
