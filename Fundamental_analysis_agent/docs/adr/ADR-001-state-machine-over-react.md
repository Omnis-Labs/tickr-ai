# ADR-001 — State machine over ReAct for the browser agent

**Date:** 2026-05-21
**Status:** Accepted
**Context for:** Task 1 — Browser Automation Agent

## Context

The standard quick-build for a browser agent is a ReAct loop: at each step, ask
the LLM "given the page, what should you do next?", parse a tool call, execute,
feed the result back in, repeat. It is easy to prototype and shows well in demos.

For a production quant-firm system, ReAct has structural problems:

1. **Unbounded cost.** Every step is a free-form LLM call. There is no natural
   cap on calls per task, and pathological inputs can loop indefinitely until a
   blunt step-limit kicks in.
2. **Silent failure surface.** ReAct typically treats "the action ran without
   throwing" as success. There is no first-class verification step. A click
   that hit the wrong element looks identical to a click that hit the right one.
3. **No failure attribution.** When a 7-step task fails, blame is diffuse across
   "the model"; you cannot point at the planner vs the locator vs the verifier.
4. **Hard to unit test.** A monolithic loop with prompt-as-control-flow can only
   be tested end-to-end. Layered systems can mock the surrounding stages.
5. **Recovery is implicit.** ReAct retries by re-prompting; what changes on the
   next iteration is whatever the model decides. There is no rule like "if the
   selector was stale, switch to semantic locator."

## Decision

Implement the agent as an explicit state machine:

```
PLAN → LOCATE → ACT → VERIFY → DONE / REPLAN / ESCALATE
              ↑          │ fail
              └ DIAGNOSE ←┘
```

- **PLAN** runs once per task; produces an ordered list of typed `PlannedStep`s.
- **LOCATE** is a separate stage with its own prompt, taking a DOM snapshot.
- **ACT** is pure Playwright. It executes a single step. No LLM.
- **VERIFY** is mandatory after every ACT. CHEAP-tier LLM judges whether the
  page state satisfies the step's `success_criteria`. This is the silent-failure firewall.
- **DIAGNOSE** runs only on failure. It must produce a typed `RecoveryStrategy`
  drawn from a closed set: `RELOCATE`, `WAIT_AND_RETRY`, `REPLAN_FROM_STEP`,
  `ESCALATE`, `ABORT`. "Just retry the same thing" is not a valid output.

## Consequences

### Positive

- **Cost per task is bounded.** Each task triggers ≤ 1 planner call + ≤ 1
  locator call per step + 1 cheap-tier verifier per step + ≤ N diagnoser calls
  capped by `TASK1_MAX_RECOVERY_ATTEMPTS`. Budget math is now possible.
- **Failure has an owner.** A failed task points at a specific state. We can
  build a metric for "verifier rejection rate" or "diagnose → escalate ratio"
  per site.
- **Recovery is auditable.** Every recovery decision is a `Diagnosis` record
  with `failure_kind` + `recovery_strategy` + `parameters` — replayable.
- **Each stage is unit-testable.** Planner, locator, verifier, and diagnoser
  are pure functions over typed inputs.

### Negative

- **More code than ReAct.** ~5 small modules instead of one loop. Worth it
  for the testability and observability gain.
- **Less adaptive on truly novel sites.** A free-form ReAct loop will sometimes
  improvise on weird pages where our state machine ESCALATEs. For an interview
  project we accept this; in prod we'd raise the escalation rate as a feature
  ("the system says it doesn't know — go look") not a bug.

## Alternatives considered

- **Pure ReAct with `browser-use` / `Skyvern`** — rejected for the above reasons,
  and because the test rubric explicitly penalises "try/except retries" rebranded as self-correction.
- **Hierarchical agent (manager + worker)** — overkill for the scope; deferred until cross-site reasoning becomes the bottleneck.
- **Hard-coded site adapters per domain** — would maximise reliability on the
  supported few sites but loses the "generalised agent" framing that is the
  whole point of Task 1.
