# ADR-003 — Deterministic fault injection for recovery-loop verification

**Date:** 2026-05-21
**Status:** Accepted
**Context for:** Task 1 — Browser Agent eval harness.

## Context

The rubric explicitly tests for "substance of self-correction (not just
try/except retries)." The browser agent has a recovery loop:
`VERIFY fails → DIAGNOSE → choose strategy → re-LOCATE / ACT`. We need to
prove it works.

Initial eval baseline (v2, 6 cases) showed `recovery_rate = 0%` — every
passing case passed first-try. This is "good" in the sense that the agent
made few mistakes, but it's "bad" as evidence: we cannot demonstrate the
recovery code works just by running the happy path.

Two regimes that would observably exercise recovery:

1. **Wait for a real failure** — flaky external pages, transient locators.
   Cheap but not reproducible; depends on luck.
2. **Inject a synthetic failure** — corrupt the agent's state at a chosen
   point and assert that recovery rescues it.

The first is what we observe in production. The second is what tests need.

## Decision

Add an **eval-only** fault-injection registry, keyed by `job_id`.

```python
# task1_browser_agent/eval/fault_injection.py
def register(job_id: str, spec: dict) -> None: ...
def should_inject_locator_fault(*, job_id, step_index, action) -> bool: ...
```

A single hook in `state_machine.py` (post-LOCATE) consults the registry. If a
matching fault is configured AND its `attempts` budget is not exhausted, the
state machine overwrites `step.locator.primary` with a known-bad selector and
yields a transparent SSE event:

```
[LOCATE:2] Fault-injected: locator corrupted to force recovery
```

Production code never writes to the registry. The eval runner reads
`fault_inject:` from `eval_set.yaml` per-case:

```yaml
- id: recovery-stale-locator-then-succeed
  fault_inject:
    on_action: type     # match first 'type' step
    attempts: 1         # corrupt only the first attempt
    type: stale_locator
  assertions:
    status: succeeded
    fault_must_fire: true
    min_recovery_attempts: 1
    expected_failure_kind: stale_selector
    contains: "Bohr"
```

Assertions:

- `fault_must_fire` — the registry must record at least one trigger.
- `min_recovery_attempts` — `job.recovery_attempts` must be ≥ N.
- `expected_failure_kind` — at least one step must have had this `failure_kind`.

Together these assert the *flow* (fault → fail → diagnose → retry → succeed),
not just the terminal state.

## Consequences

### Positive

- **Recovery is now testable**, deterministically. `recovery-stale-locator-
  then-succeed` produces a reliable 1-recovery success on every run, even on
  otherwise-easy tasks.
- **The inspector page** (`/jobs/[jobId]`) shows fault metadata side-by-side
  with the step trace, so reviewers can see the fault firing and the recovery
  loop catching it.
- **Recovery rate is a real metric** — we observed 18.2% in one run (1 fault-
  injection case + 1 real-world Turing-paragraph recovery), which is honest:
  the loop saves both synthetic and natural failures.

### Negative

- **Eval set contamination risk.** Fault-inject cases inflate `recovery_rate`
  artificially. We mitigate by tagging the case `category: recovery_test`
  and reporting `by_category` breakdown — reviewers can subtract the synthetic
  contribution from the rate if they want the natural number.
- **One more eval-only code path** in production code. The state-machine hook
  is one `import` + one `if`, but is real. We accept the small footprint
  for the test-coverage win.

## Alternatives considered

- **Mock the LLM responses to force specific failures.** Possible but
  brittle — couples the test to internal prompt wording.
- **Run the eval many times and rely on stochastic failures to exercise the
  loop.** Expensive ($0.005 × 15 × N runs) and still not deterministic.
- **Write unit tests against `diagnoser.diagnose()` directly.** We have those
  too. But integration evidence (state-machine + executor + LLM + recovery
  loop end-to-end) is the unique value of fault injection.
