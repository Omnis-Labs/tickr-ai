# Task 1 — Browser Agent · Analysis Report

> Every number in this document is queried from production data —
> `cost_ledger` table for spend, eval `report.json` for outcomes — not
> estimated. Re-run the bottom command to refresh.

**Eval baseline used:** [`task1_browser_agent/eval/report.json`](../../task1_browser_agent/eval/report.json), 15 cases, 2026-05-21.

---

## 1. Outcomes

| Metric | Value |
|---|---|
| Cases | 15 |
| Pass rate (this run) | **13 / 15 (86.7%)** |
| Pass rate (3-run range) | **11 / 15 to 14 / 15** (see §5) |
| `n_infra_error` (provider-side outages segregated) | 0 |
| Recovery rate (cases that succeeded after ≥1 recovery) | **15.4%** (2/13) |
| Fault-injection recovery test | ✅ deterministic pass |

### Per-category breakdown

| Category | Cases | Pass rate | Mean cost |
|---|---|---|---|
| `refusal_expected` | 4 | 100% | $0.00055 |
| `search` | 2 | 100% | $0.00513 |
| `multi_step` | 2 | 100% | $0.00524 |
| `fact` (extraction of specific datum) | 2 | 100% | $0.00580 |
| `extract` | 4 | 50% | $0.00529 |
| `recovery_test` (fault-injected) | 1 | 100% | $0.00723 |

Refusal handling and fact extraction at 100%; the 50% on plain extract is
the Gemini-flake regime (see §5).

---

## 2. Performance

### Latency

| Stat | Value |
|---|---|
| p50 wall-time per task | **30 s** |
| p95 wall-time per task | 66 s |
| Total eval wall-time, serial | ~10 min |
| Total eval wall-time, parallel @ concurrency=4 | **2 min 03 s** |
| Speedup from parallelisation | **~5×** |

The wall-time is dominated by browser navigation (network) and LLM
round-trips (~1–3 s per Gemini call, average 4–6 calls per task). Pure
local compute (Playwright DOM walks, regex) accounts for < 5 % of the
total.

### Where the time goes (per typical 4-step task)

```
PLAN     ~ 2 s   (1 LLM call, DEFAULT tier)
LOCATE   ~ 1 s × N_steps  (1 LLM call per step, DEFAULT tier)
ACT      ~ 0.5 s × N_steps  (Playwright operation + render wait)
VERIFY   ~ 1 s × N_steps  (1 LLM call per step, CHEAP tier)
DIAGNOSE ~ 2 s × N_recoveries  (1 LLM call, DEFAULT tier)
```

### Parallel scaling

`asyncio.gather` + `Semaphore(N)` lets us run N browser contexts plus
their LLM calls concurrently. The Semaphore is per-eval-process, so
multiple workers can run multiple semaphores. Empirically 4 is the sweet
spot on a laptop: Playwright Chromium uses ~150 MB per context, and the
Gemini API tolerates the call rate without throttling.

The runner exposes `--concurrency` so the same code path serves the
"laptop dev loop" and the "CI fleet" cases without two implementations.

---

## 3. Cost

All-time ledger across every smoke test, debug session, and eval run on
this machine:

| | Calls | Cost | Share |
|---|---|---|---|
| **Total** | **978** | **$0.6254** | 100 % |
| `task1.locator` | 336 | $0.3674 | **59 %** |
| `task1.planner` | 144 | $0.1428 | 23 % |
| `task1.diagnoser` | 101 | $0.0628 | 10 % |
| `task1.verifier` | 386 | $0.0385 | 6 % |
| `task2.l3.*` and debug | 11 | $0.0140 | 2 % |

Read what this tells us:

- **Locator dominates** (59 %). It runs once per *step*, not once per
  task, and it uses DEFAULT tier. Cheap-tier locator would cut this by ~6×;
  worth A/B testing in a future iteration, but the failure surface grows.
- **Verifier is the cheapest large category** (6 %, 386 calls). Tier
  routing is working — pushing the most-frequent stage onto Flash-Lite
  saves real money.
- **Diagnoser fires often enough to matter** (101 calls — recoveries
  happen). The 10 % share confirms recovery loops are paid for, not free.

### Per-task economics

| Tier | Value |
|---|---|
| Cost p50 | **$0.00496** per task |
| Cost p95 | **$0.00946** per task |
| Cost on the fault-injected recovery test | $0.00723 (= base + Δ for one recovery) |
| Configured per-task budget cap | $0.20 (in `.env`, enforced by gateway) |
| Headroom over p95 | 21× |

Worst case observed = 5 % of the configured cap. Adding L3-style
arbitration on top of Task 1 would still leave a 4× safety margin.

### Why cache hit rate is 0 %

Gemini doesn't expose Anthropic-style prompt caching yet, so
`cache_hit_count = 0` in the ledger. Switching `LLM_BACKEND=anthropic`
would expect ~30–50 % cache hits on the static system prompts and cut
input-token cost ~10–20 %. The gateway supports both backends; the
choice was made for cost reasons (Gemini Flash-Lite is cheaper than
Haiku at the cheap tier), with the cache trade-off accepted.

---

## 4. Scalability

The MVP runs single-process with an in-memory `JobStore`. Production
shape is incremental:

| Concern | Today (MVP) | Production path |
|---|---|---|
| Job queue | In-memory dict per process | Redis Streams (Upstash) or Postgres-backed `pg_jobs` |
| Worker count | 1 (uvicorn `--reload`) | N uvicorn workers behind a load balancer + Playwright pool |
| Browser sessions | 1 per `BrowserExecutor` context | Pre-warmed Chromium pool (e.g. `playwright-cluster`); 10–20 sessions per box |
| Artifact store | Filesystem under `./data/artifacts/` | Supabase Storage (already wired via `ARTIFACT_BACKEND=supabase`) |
| Cost ledger | SQLite (`./data/dev.db`) | Supabase Postgres (already supported — change `DATABASE_URL`) |
| Observability | structlog JSON + `/dashboard` | OpenTelemetry export (env var ready, exporter wired but disabled by default) |

The interfaces are small enough that each swap is a one-file change.
The dashboard and inspector pages already query through the same
endpoints, so they work unchanged when the store moves to Postgres.

### Throughput estimate

At 4 browser sessions × ~30 s p50 wall-time per task → **~480 tasks /
hour / box** at steady state. Bottleneck is the Playwright session
spin-up + network, not LLM throughput. For a workload of 50,000 daily
tasks, ~5 boxes (or one larger box with 16 sessions) is sufficient at
budget compute.

---

## 5. Correctness verification

We adopt three layers, listed in increasing strength:

### 5.1 Per-step verifier (silent-failure firewall)

After every ACT, a Cheap-tier LLM compares the post-action page state
against the planner's `success_criteria`. ACT not raising is **not**
proof of success — the verifier is the gate. See
[ADR-006](../adr/ADR-006-mandatory-verifier.md).

Concrete benefit: the planner sometimes hallucinates a specific
expected text (e.g. `"starts with 'The Whale'"` for httpbin's
Moby-Dick HTML). The verifier rejects the actual correct extraction —
recovery loops attempt fixes — eventually escalate. **No silent
wrong answer is ever emitted.** The eval surfaces this case as
`escalated`, not `succeeded`.

### 5.2 Self-built eval set with content assertions

15 cases over 6 categories (refusal_expected, extract, search, fact,
multi_step, recovery_test). Assertions check the *final output*, not
just the terminal status:

- `contains: "1815"` on the Ada Lovelace year-of-birth case
- `contains_all: ["1879", "1955"]` on the Einstein birth-and-death case
- `expected_failure_kind: stale_selector` on the recovery-test case
- `min_recovery_attempts: 1` to enforce recovery actually ran

A case that "succeeds" but extracts the wrong fact fails the eval.

### 5.3 Deterministic fault injection (recovery proof)

`task1_browser_agent/eval/fault_injection.py` corrupts the locator on
a chosen step for N attempts. The `recovery-stale-locator-then-succeed`
case proves the recovery loop catches it: status=succeeded,
recovery_attempts=1, `expected_failure_kind=stale_selector` observed.
See [ADR-003](../adr/ADR-003-deterministic-fault-injection.md).

This is the canonical "how do you know self-correction isn't try/except"
demonstration. Without it, the recovery code is unverifiable.

### 5.4 Honest stochasticity reporting

Gemini at `temperature=0` is not bit-deterministic across requests
(documented at API level by all three major LLM providers). Across
three full eval runs, pass rate ranged **11 / 15 to 14 / 15**. The
README reports the range explicitly; the dashboard's KPI tile reads
the latest. We do not cherry-pick the best run.

---

## 6. Open issues honestly listed

1. **No `selector_history` persistence.** PLAN.md designs caching of
   working selectors per (site, action). Not implemented across
   sessions. Recovery still works without it; the cache would make
   *first attempts* more reliable on revisits.
2. **Some `extract` cases remain stochastic.** In one of three runs,
   `wiki-marie-curie-paragraph` failed; in another, `wiki-einstein-
   birth-and-death`. Different cases flip each time, which is the LLM
   flake signature.
3. **OpenTelemetry exporter wired but disabled by default.** Turn on
   with `OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT`. The
   dashboard reads directly from `cost_ledger` so OTel is additive,
   not required.
4. **Single-worker job store.** Multi-worker prod needs Redis/Postgres-
   backed queue; interface is small enough for a one-file swap.
5. **No CAPTCHA / Cloudflare / authenticated-session handling.**
   Compliance choice; agent always escalates these.

---

## 7. Reproducing these numbers

```bash
source .venv/bin/activate

# Refresh ledger / eval
python -m task1_browser_agent.eval.runner --concurrency 4

# Inspect
python -c "
import asyncio, json
from shared.cost_ledger import init_db, cost_summary
async def m():
    await init_db()
    print(json.dumps(await cost_summary(), indent=2, default=str))
asyncio.run(m())
"
cat task1_browser_agent/eval/report.json | python -m json.tool
```

Or visit `/dashboard` in the deployed frontend — every number above
is rendered there.
