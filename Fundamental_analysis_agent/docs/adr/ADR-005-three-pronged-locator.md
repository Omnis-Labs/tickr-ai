# ADR-005 — Three-pronged locator + prong-escalation on retry

**Date:** 2026-05-21
**Status:** Accepted
**Context for:** Task 1 — Browser Agent locator + self-maintenance.

## Context

The single biggest source of browser-agent brittleness is the locator: the
LLM produces a CSS selector, the page renders with a slightly different DOM
(A/B test, framework rebuild, locale change), the selector goes stale, the
step fails.

A naive retry doesn't fix this — the LLM, faced with the same input, produces
the same broken selector. We need **diversity** across attempts: not just
"try again" but "try differently."

The rubric explicitly tests for "self-maintenance — detect UI / selector
changes and adjust locator strategies dynamically."

## Decision

Every locator is a triple, ranked by independence of failure mode:

```python
class Locator(BaseModel):
    primary: str | None        # CSS or XPath  — high specificity, low robustness
    semantic_role: str | None  # ARIA role     — survives visual redesigns
    semantic_name: str | None  # accessible name
    visual_text: str | None    # visible text  — last resort, depends on copy
```

At execution time, the executor probes them in order: `primary` → `semantic`
→ `visual`. First match wins. The three prongs fail independently — a CSS
class rename does not affect ARIA roles; an ARIA refactor does not affect
visible copy.

When a step fails and DIAGNOSE chooses `RELOCATE`, the next attempt:

1. **Adds the failed primary selector to the `avoid_selectors` list** in the
   next locator prompt. ("Don't propose what just didn't work.")
2. **Escalates the prong preference**: attempt 1 fail → `prefer_semantic`;
   attempt 2 fail → `prefer_visual`.
3. When `prefer_visual=True` AND the visible text candidate is substantive
   (≥ 8 chars), the locator's `primary` and `semantic_*` are **forced to
   null** so the executor cannot try them and waste budget.
4. For EXTRACT actions specifically, the executor has a structural last-
   resort fallback (`.mw-parser-output > p, article p, main p, body p`) so
   extract steps recover even when no specific visible text is known.

## Consequences

### Positive

- **Recovery is selector-aware, not amnesiac.** The first v3 eval baseline
  (12/15 → 13/15 after fix) showed `recovery_attempts=3` cases where the
  locator LLM kept proposing variations of the same broken selector. With
  the avoid-list + prong escalation, Marie Curie and Einstein
  place-of-birth now pass first-try.
- **EXTRACT actions are robust.** The structural last-resort means we don't
  need to know the article's exact text in advance to extract its first
  paragraph — a property critical to generalisation across sites.
- **Diagnose strategy choice is honoured, not advisory.** The `prefer_visual`
  fence is enforced in code, not asked-of-the-LLM. The locator prompt is
  still TOLD to use visual; the post-processing also ENSURES it.

### Negative

- **More state per step.** Each step carries `failed_primary_selectors`,
  `prefer_semantic`, `prefer_visual`. The state-machine code is larger.
- **Visual prong is fragile to copy changes** — an A/B test of button text
  breaks visual-only locators. We accept this because visual is the last
  resort; if all three prongs fail, the recovery loop escalates to the
  diagnoser anyway.

## Alternatives considered

- **Single CSS selector + retry with `temperature=0.3`** to introduce
  selector diversity. Rejected — adds non-determinism to the agent's plan
  without a principled fallback ordering.
- **Vision model on screenshot to locate by visual layout.** Strictly more
  robust but expensive and slow. A good future addition; not required to
  prove the architecture.
- **Cache successful selectors per (site, action)** to skip the LLM entirely.
  Designed in PLAN.md as `selector_history`; not yet implemented across
  sessions. Recovery still works without it; cache makes the *first* try
  more reliable on revisits.
