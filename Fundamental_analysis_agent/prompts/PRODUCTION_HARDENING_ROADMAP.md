# Production Hardening Roadmap
## Whaleforce LLM Test → Quant-Firm Production System

> This document is a working spec for taking the current interview deliverable
> (a deployed two-task system covering browser automation and SEC 10-K
> extraction) to a state where a professional quantitative finance firm could
> reasonably adopt it for internal research workflows.

**Status:** Active. PRs land against `main`; each completed item updates the
checkbox here.

**Last reviewed:** 2026-05-28

---

## 0. Context

The current system was built to pass an LLM Engineer coding test. It scores
well on the rubric (eval discipline, layered fallbacks, calibrated confidence,
cost attribution, honest failure modes), and it is publicly deployed at
`https://whaleforce-llm-test.vercel.app` with a Railway backend and a Supabase
data layer.

But "good interview deliverable" and "system a quant firm pays to use" are
two different bars. The eight-week plan below closes the delta on the
dimensions a buying quant team will actually evaluate:

1. **Security posture** — auth, secrets, audit, rate-limit, retention.
2. **Reproducibility** — deterministic re-runs, model + prompt pinning,
   point-in-time correctness, backtest-friendly outputs.
3. **Operational maturity** — SLO, monitoring, alerting, deploy discipline,
   disaster recovery.
4. **Multi-tenant readiness** — per-team budgets, quotas, data isolation.
5. **LLM governance** — A/B prompt testing in prod, human-in-the-loop
   review for quarantined outputs, prompt injection defense, calibration
   drift detection.
6. **Quant-specific workflow** — batch APIs, webhooks, as-of dates,
   filing-amendment tracking, dedup.

The plan is structured as **eight one-week sprints**. Each sprint has one to
four self-contained PRs sized to fit a week of focused work; each PR is
described with a goal, deliverables, acceptance criteria, and a verification
step.

Items in the body of this document are checkable in-place
(`- [ ]` → `- [x]`) as PRs land.

---

## 1. Out of scope

The following are *not* addressed in the 8-week plan:

- **SOC 2 / ISO 27001 audit.** Requires 6–12 months of evidence collection
  by a specialist team.
- **24/7 on-call rotation.** Requires a hire and an operational runbook
  that we do not yet have responders for.
- **Multi-region active-active failover.** Single-region is acceptable for
  the initial buying customer; cross-region disaster recovery is a Year-2
  problem.
- **Support for non-10-K SEC forms** (10-Q, 8-K, S-1, 20-F). Out of scope
  per the original Task 2 framing.
- **OCR for image-only PDF filings.** A separate ingestion pipeline
  problem; defer until a customer asks.

---

## 2. Acceptance criteria — "production-ready" definition

The system is production-ready when ALL of the following are demonstrably
true:

| # | Criterion | How we measure |
|---|---|---|
| 1 | Every endpoint requires authentication; unauthenticated requests get HTTP 401 | curl without token → 401 |
| 2 | Every API call is rate-limited per-tenant and per-key | Burst test trips the limiter at the configured threshold |
| 3 | Every state-changing request creates one audit_log row before the response returns | `SELECT COUNT(*) FROM audit_log` matches `SELECT COUNT(*)` of recent jobs |
| 4 | API key, LLM key, and DB credentials are stored in a secrets manager, never in environment text files | Inspecting `.env` shows no secrets in plaintext on prod |
| 5 | Job state survives container restart | Restart the backend, /jobs/{old_id} still returns the inspector payload |
| 6 | Eval pass rate cannot regress more than 2 pp without CI failing the deploy | Manually push a known-bad prompt change → CI fails |
| 7 | p95 backend latency, error rate, and daily cost are monitored on a dashboard that wakes on-call within 60 s when crossed | PagerDuty test alert reaches the responder phone |
| 8 | Multi-tenant: a tenant's data, cost ledger, and jobs are isolated from every other tenant | A query as Tenant A's role returns zero rows from Tenant B's tables |
| 9 | Per-tenant budget cap rejects requests after spend exceeds limit (not after) | Curl test confirms the 402 response on the cap-exceeding request |
| 10 | LLM extractions are reproducible: same input + locked model/prompt version → identical output | `replay_job(job_id)` returns bit-identical result to original within determinism tolerance |
| 11 | Quarantined extractions surface in a reviewer queue UI, not just a flag | `/admin/quarantine` UI lists every quarantined item with reviewer assignment |
| 12 | A documented incident-response runbook exists for every alert | `docs/runbooks/<alert>.md` exists for every PagerDuty alert |

---

## 3. Week-by-week plan

Each sprint is **one week** of focused implementation. PRs are scoped to be
mergeable independently; week boundaries are guidance, not contracts.

### Week 1 — Authentication, rate limiting, audit log

**Goal:** Close the highest-priority security and compliance gaps that
otherwise prevent any commercial conversation.

**PRs in this sprint:**

- [ ] **PR-101: API key authentication via FastAPI middleware**
  - Add `auth/` package with: `APIKey` Pydantic model, `verify_key` async
    helper, FastAPI `Depends` for protected routes.
  - New table `api_keys (id, key_hash, tenant_id, label, created_at, revoked_at)`.
    Store SHA-256 of the key; the plaintext is shown once at creation and
    never persisted.
  - All `/task1/*` and `/task2/*` endpoints require `Authorization: Bearer <key>`.
  - `/task1/health` stays public for uptime probes.
  - **Acceptance:** `curl` without header → 401; with valid key → 200.

- [ ] **PR-102: Rate limiting via slowapi**
  - Integrate `slowapi` with Redis backend (Supabase doesn't host Redis;
    add Upstash Redis as a sibling).
  - Default cap: **60 req/min** per API key, **6 req/min** per IP for
    expensive endpoints (`/task1/jobs` POST, `/task2/extractions` POST,
    `/task2/edgar/parse` POST).
  - Header response includes `X-RateLimit-Remaining`.
  - **Acceptance:** Burst script hits 61st request → 429 with
    `Retry-After`.

- [ ] **PR-103: Audit log table + middleware**
  - New table `audit_log (id, request_id, api_key_id, tenant_id, method,
    path, status_code, latency_ms, ip, user_agent, request_body_sha256,
    response_body_sha256, occurred_at)`.
  - FastAPI middleware writes one row per request before the response is
    returned. Failure to write is logged but does not block the response —
    audit-log unavailability must not become a denial-of-service vector.
  - Body hashes are deterministic; full bodies are NOT persisted (privacy
    + storage cost).
  - **Acceptance:** Hit `/task1/health` 3 times → `SELECT COUNT(*) FROM
    audit_log WHERE path = '/task1/health'` returns 3.

- [ ] **PR-104: Secrets manager integration**
  - Move `GEMINI_API_KEY`, `SUPABASE_SERVICE_KEY`, and any future internal
    keys from Railway env vars to a secrets-manager backend.
  - **Choice between:** Doppler (free tier, simplest), AWS Secrets Manager,
    or HashiCorp Vault. Default to Doppler for time-to-value.
  - Backend reads secrets at startup via the secrets-manager SDK.
  - Railway env vars retain only `DOPPLER_TOKEN` (or equivalent).
  - **Acceptance:** Inspecting Railway env shows no LLM/DB keys; backend
    still starts and responds normally.

---

### Week 2 — Persistent job store and migrations

**Goal:** Job state survives container restart. Schema changes are
versioned and reviewable.

**PRs in this sprint:**

- [ ] **PR-201: Alembic migrations**
  - Add Alembic to the project. `alembic init`, configure for our async
    engine.
  - Snapshot the current schema (`cost_ledger`, `selector_history`,
    `api_keys`, `audit_log`) into `alembic/versions/0001_initial.py`.
  - Replace `Base.metadata.create_all()` on startup with `alembic upgrade
    head` in the Docker entrypoint.
  - CI checks that `alembic upgrade head` from an empty DB succeeds.
  - **Acceptance:** Fresh Postgres + `alembic upgrade head` → schema matches
    `SELECT * FROM information_schema.tables`.

- [ ] **PR-202: Persistent Task 1 job store**
  - New tables: `task1_jobs`, `task1_steps`, `task1_step_events`.
  - Move `task1_browser_agent.api.job_store.JobStore` from in-memory dict
    to a SQL-backed implementation. Use SQLAlchemy ORM; pure interface
    swap from the caller's perspective.
  - SSE events are still in-memory queues (no need to persist transient
    events), but the parent `Task1Job` row is.
  - **Acceptance:** Run a Task 1 job → restart Railway → `/jobs/{job_id}`
    inspector still loads.

- [ ] **PR-203: Persistent Task 2 job store**
  - Same pattern: `task2_jobs` table replaces `_JOBS` dict in
    `task2_10k_extractor/api/router.py`.
  - **Acceptance:** Same as PR-202 but for Task 2.

- [ ] **PR-204: Inspector "job not found" message clarification**
  - Update the failure message on `/jobs/[jobId]` to reflect persistence
    is now real; remove the "container restart clears state" caveat.
  - **Acceptance:** Unknown ID still 404s with helpful message.

---

### Week 3 — Multi-tenancy and per-tenant budgets

**Goal:** Two tenants can coexist on the same backend with full data
isolation and independent cost caps.

**PRs in this sprint:**

- [ ] **PR-301: `tenants` table + tenant_id everywhere**
  - New table `tenants (id, name, plan, created_at)`.
  - Add `tenant_id` column to every existing table (`api_keys`, `audit_log`,
    `cost_ledger`, `selector_history`, `task1_jobs`, `task2_jobs`,
    `task1_steps`).
  - Backfill an `"interview-demo"` tenant for all existing rows.
  - **Acceptance:** Schema dump shows `tenant_id` on every domain table.

- [ ] **PR-302: Row-level security in Postgres**
  - Define a `current_tenant_id` GUC; RLS policy on each domain table
    filters on it.
  - FastAPI dependency sets the GUC at the start of each request based on
    the API key's tenant.
  - **Acceptance:** A SQL session impersonating Tenant A returns 0 rows
    from `cost_ledger` rows belonging to Tenant B.

- [ ] **PR-303: Per-tenant budget enforcement**
  - New tables `tenant_budgets (tenant_id, daily_usd_cap, monthly_usd_cap)`
    and (rolling 24 h) `tenant_spend_24h` materialised view.
  - In `LLMGateway.call()`, before issuing the LLM request: query current
    24 h spend; if + estimated_cost > daily cap, raise `BudgetExceededError`
    with the tenant_id in the message.
  - HTTP layer turns this into 402 Payment Required (not 500).
  - **Acceptance:** Set a $0.01 cap on the demo tenant; run two Task 1
    jobs → second one fails with 402.

- [ ] **PR-304: Tenant admin endpoints**
  - `GET /admin/tenants` (list, requires admin scope)
  - `POST /admin/tenants` (create)
  - `POST /admin/tenants/{id}/keys` (mint API key for a tenant)
  - `POST /admin/tenants/{id}/budget` (set daily/monthly cap)
  - Admin scope is granted via a separate "admin" API key class.
  - **Acceptance:** Curl flow from create-tenant → mint-key → use-key →
    spend → cap works end-to-end.

---

### Week 4 — CI/CD discipline

**Goal:** Every change is gated by automated tests and an eval-regression
check before reaching prod.

**PRs in this sprint:**

- [x] **PR-401: GitHub Actions baseline workflow** (lint + typecheck +
  Task 2 eval regression gate)
  - Replaced by `.github/workflows/ci.yml` in this commit. See file for
    detail; first CI green build links here.

- [ ] **PR-402: Task 1 eval in CI (nightly)**
  - Separate scheduled workflow (cron 0 6 \* \* \*) runs the full Task 1
    eval (15 cases) using real Gemini API.
  - Posts results to a Slack webhook on regression > 2 pp.
  - Requires `GEMINI_API_KEY` in GitHub Secrets, scoped to this workflow.
  - **Acceptance:** Nightly run for a week without false positives.

- [ ] **PR-403: Canary deploys via Railway promotion or migrate to Fly.io**
  - Railway's native model is direct-to-prod. Either:
    (a) configure two Railway services (staging + prod), promote on green
        smoke test, OR
    (b) migrate the backend to Fly.io which supports gradual rollout.
  - Default: (a) — same platform, less migration risk.
  - **Acceptance:** Push to main goes to staging; manual promote button
    moves it to prod.

- [ ] **PR-404: Deploy notes + rollback playbook**
  - Per-release `RELEASE_NOTES.md` template auto-filled by the merge.
  - `docs/runbooks/rollback.md` documents `railway redeploy <previous-id>`
    and the Supabase point-in-time recovery procedure.
  - **Acceptance:** Dry-run rollback drill performed and timed.

---

### Week 5 — Batch API, webhooks, SDK

**Goal:** A quant team can submit 5,000 10-Ks overnight and receive
results via webhook the next morning, without writing custom orchestration.

**PRs in this sprint:**

- [ ] **PR-501: Batch extraction API**
  - `POST /task2/batches` accepts up to 1000 URL inputs.
  - Returns a `batch_id` immediately; processing is async via a worker
    pool (Redis queue + N worker processes).
  - `GET /task2/batches/{id}` returns progress, completed_count,
    failed_count, total_cost_so_far, ETA.
  - **Acceptance:** Submit a 50-URL batch → all jobs complete within
    rate-limit window → final report downloadable.

- [ ] **PR-502: Webhook delivery on job completion**
  - `POST /webhooks/register` with target URL + secret + event type
    (`job.succeeded`, `job.quarantined`, `batch.completed`).
  - Webhook delivery is at-least-once with exponential backoff up to 24 h.
  - Payload is signed with HMAC-SHA256 using the registered secret.
  - **Acceptance:** Register a webhook to `webhook.site` → run a job →
    payload arrives with correct signature.

- [ ] **PR-503: Python SDK**
  - `pip install whaleforce-extractor` — auto-generated from the FastAPI
    OpenAPI spec via `openapi-python-client`.
  - Published to TestPyPI initially.
  - **Acceptance:** SDK example script runs end-to-end with a real API key.

- [ ] **PR-504: API versioning**
  - Move all current endpoints under `/v1/` prefix. Keep an alias from
    the legacy paths for 90 days.
  - Open the door for `/v2/` when breaking changes are needed.
  - **Acceptance:** OpenAPI spec lists `/v1/*`; legacy `/task1/health`
    302-redirects to `/v1/task1/health`.

---

### Week 6 — Observability and on-call

**Goal:** When something goes wrong in production, the responder knows
within 60 seconds and has the data to diagnose within 5 minutes.

**PRs in this sprint:**

- [ ] **PR-601: OpenTelemetry → Honeycomb**
  - Connect the existing OTel instrumentation to a Honeycomb account
    (free tier is fine for the first month).
  - Add `HTTPXClientInstrumentor` so outbound Gemini calls get their own
    spans.
  - Custom span attributes on `task1.locator`, `task1.planner`,
    `task2.l3.*` so a Honeycomb query can slice latency / cost by stage.
  - **Acceptance:** A Task 1 job appears as a trace with N spans, one
    per LLM call and one per Playwright action.

- [ ] **PR-602: PagerDuty alerts on SLOs**
  - Define SLOs:
    - Backend availability ≥ 99.5% over rolling 30 d.
    - p95 backend latency < 60 s.
    - Task 1 eval pass rate ≥ 75% (rolling 7 d).
    - Daily cost across all tenants < $25.
  - Honeycomb triggers fire to PagerDuty when an SLO is at risk.
  - **Acceptance:** Manually trip each SLO in staging → PagerDuty pages.

- [ ] **PR-603: Status page**
  - Publish a public StatusPage.io page (free tier) showing API
    availability and Task 1/Task 2 success rate.
  - Configure StatusPage to read from Honeycomb's SLI metrics.
  - **Acceptance:** Status page is live at `status.whaleforce-test.dev`.

- [ ] **PR-604: Incident response runbook**
  - For each PagerDuty alert, a `docs/runbooks/<alert>.md` describes:
    - What the alert means.
    - Quick triage steps (≤ 5 commands).
    - Escalation criteria.
    - Common root causes from past incidents.
  - **Acceptance:** Every alert in PagerDuty has a runbook link in its
    description.

---

### Week 7 — LLM governance: human-in-the-loop, prompt versioning, drift

**Goal:** Quant teams have UI-level controls for the LLM-stochastic parts
of the system; calibration is monitored for drift.

**PRs in this sprint:**

- [ ] **PR-701: Quarantine review queue UI**
  - New route `/admin/quarantine` lists every Task 2 extraction with
    `quarantined: true`, ordered by ingest time.
  - Each row links to `/jobs/{id}` inspector + has a "release" button
    (writes `released_by` + `released_at` to a `quarantine_decisions`
    table) and a "reject" button.
  - **Acceptance:** Reviewer can release or reject a quarantined item; the
    decision is auditable.

- [ ] **PR-702: Prompt version tracking and A/B testing**
  - Move prompts from filesystem (`prompts/`) to a `prompt_versions` table
    with (name, version, system, user_template, created_at, traffic_pct).
  - LLM Gateway selects a prompt version per-tenant per-purpose based on
    traffic_pct (50/50 split for A/B).
  - Cost ledger records `prompt_version` per call so we can compare
    effectiveness later.
  - **Acceptance:** A new prompt version can be rolled out to 10% of
    traffic for one purpose; the cost / pass-rate / confidence delta is
    queryable in SQL.

- [ ] **PR-703: Calibration drift monitor**
  - Nightly job re-evaluates calibration over the past 7 days' labelled
    outputs (using synthetic labels from `bootstrap_calibration.py` as
    proxy until human labels arrive).
  - If ECE > 0.10 OR Brier > 0.10, write to `calibration_alerts` and ping
    PagerDuty.
  - Dashboard plot shows ECE / Brier over time.
  - **Acceptance:** Deliberately introduce a confidence-skewed prompt
    change → drift monitor flags it within 24 h.

- [ ] **PR-704: Prompt-injection defense at API boundary**
  - For any user-supplied text that will be fed to an LLM
    (`task1.task_description`, `task2.edgar.parse:input`), apply:
    - Length cap (already exists; enforce strictly).
    - Reject inputs containing the literal strings `"\n\nIgnore previous instructions"`,
      `"system:"` opening a new system block, etc.
    - Wrap user input in `<user_input>...</user_input>` tags inside the
      prompt so the LLM is less likely to interpret it as an instruction.
  - Add a test suite of 20 known prompt-injection payloads.
  - **Acceptance:** 20/20 known payloads either bounce at the API or fail
    to alter the LLM's downstream behaviour.

---

### Week 8 — Reproducibility and backtest support

**Goal:** Quant teams can replay any past extraction and get an identical
result; new extractions can be tied to an as-of date for backtesting
provenance.

**PRs in this sprint:**

- [ ] **PR-801: Model version pinning**
  - Every cost_ledger row already records `model`. Extend to record
    `model_version` (the exact API version string the provider returns,
    e.g. `gemini-2.5-flash-001`).
  - On replay, the gateway uses the same `model_version` if available;
    if the provider has retired it, replay fails loud with a typed
    `ModelRetiredError` rather than silently substituting.
  - **Acceptance:** A job ledger row shows the exact model version; replay
    with a retired version produces a typed error.

- [ ] **PR-802: As-of date + amendment tracking on Task 2**
  - `task2_jobs` table: add `as_of_date` (the calendar date as which the
    extraction is to be interpreted) and `is_amendment` (true for 10-K/A
    filings).
  - EDGAR submissions API already exposes `form` for amendments; surface
    these in the parser interpretation pill.
  - **Acceptance:** A 10-K/A extraction shows `is_amendment: true` in the
    response and in the inspector UI.

- [ ] **PR-803: Replay endpoint**
  - `POST /task2/extractions/{id}/replay` reruns the original pipeline
    with the original input + pinned model + pinned prompt version.
  - Returns a new job_id with a `replay_of` reference back to the
    original.
  - The two jobs' SHA-256 content hashes should match (modulo timestamps).
  - **Acceptance:** Replay produces SHA-256 identical content for L1+L2
    cases; for L3 cases the IoU vs original is logged.

- [ ] **PR-804: Dedup on (filing_url, prompt_version, model_version)**
  - Before kicking off the orchestrator, check whether a job with the
    same input triplet has succeeded recently. If so, return the cached
    result with a `from_cache: true` flag.
  - TTL: 30 days.
  - **Acceptance:** Submitting the same filing twice in succession → second
    response is < 100 ms with `from_cache: true`.

---

## 4. Decision log

Open architectural decisions awaiting resolution:

| Date | Question | Status |
|---|---|---|
| 2026-05-28 | Auth: API key (PR-101) vs OAuth 2.0 vs both? | **Decided: API key for v1; OAuth backlogged to Year 2.** |
| 2026-05-28 | Secrets manager: Doppler vs Vault vs AWS Secrets Manager? | **Decided: Doppler for time-to-value; revisit when SOC 2 work begins.** |
| 2026-05-28 | Queue: Redis (Upstash) vs Postgres-backed (pg_jobs) vs Celery? | Open. Likely Redis on a small cluster of 4 workers. |
| 2026-05-28 | Deploy platform: stay on Railway (PR-403a) vs migrate to Fly (PR-403b)? | Open. Lean Railway. |
| 2026-05-28 | Multi-tenant isolation: shared DB with RLS vs per-tenant DB? | **Decided: shared DB + RLS for now; per-tenant DB only if a customer requires.** |

---

## 5. Non-functional commitments (the contract with customers)

Once Week 6 lands, the system commits to:

| Promise | Target |
|---|---|
| Backend availability | 99.5% measured monthly |
| p95 backend latency | < 60 s for Task 1, < 12 s for Task 2 |
| Task 2 confidence calibration | ECE ≤ 0.10 monthly |
| Eval pass rate | ≥ 90% measured weekly |
| Time to acknowledge a P1 incident | < 15 minutes |
| Time to resolve a P1 incident | < 4 hours |
| Backup recovery | RPO 24 h, RTO 8 h |
| Audit log retention | 13 months |

---

## 6. Out-of-band notes for the implementer

This document is the **source of truth** for what "production-ready" means
on this project. If a PR doesn't map to one of the items above, either:

1. The PR should be deferred (out of scope for this phase), or
2. The PR's scope should be added to this document with a rationale.

**Do not stretch a sprint week.** If a week's items are not done by Friday,
the un-done items roll to the next week and that week's items shift right.
We do not skip steps to "catch up."

**Every PR description references the line in this doc it implements.** That
is how the document stays alive.
