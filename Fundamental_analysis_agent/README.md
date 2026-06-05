# Fundamental Analysis Agent

Browser Agent · SEC 10-K Extractor · Fundamentals-driven Strategy Lab.
Implemented, deployed, and live.

| Live URL | Purpose |
|---|---|
| **https://whaleforce-llm-test.vercel.app/task1** | Task 1 — Browser Agent (submit any NL task, watch the state machine run) |
| **https://whaleforce-llm-test.vercel.app/task2** | Task 2 — SEC 10-K Item Extractor (paste an EDGAR URL, **or** a ticker, **or** a free-text query like `"微軟 年報"`) |
| **https://whaleforce-llm-test.vercel.app/dashboard** | Eval pass rates, cost ledger, capability matrices for both tasks |
| **https://whaleforce-llm-test.vercel.app/jobs/{job_id}** | Failure inspector — screenshots, DOM snapshots, step trace, eval metadata |
| **https://whaleforce-llm-test-production.up.railway.app/task1/health** | Backend health probe |

> The deployed frontends accept arbitrary input — submit anything you like
> to any of the forms.

---

## 📖 Documents worth reading first

| Order | Doc | Why |
|---|---|---|
| 1 | [PLAN.md](PLAN.md) | Full system design + the six "fail loud, never silent" design principles every later decision derives from |
| 2 | [docs/analysis/task1_report.md](docs/analysis/task1_report.md) | Task 1 perf / cost / scalability / correctness analysis — every number queried live from the cost ledger, never estimated |
| 3 | [docs/analysis/task2_report.md](docs/analysis/task2_report.md) | Same shape for Task 2 |
| 4 | [docs/VERIFICATION.md](docs/VERIFICATION.md) | 16-section living checklist with every bug found and fixed during development (root cause + fix, not "and we fixed it") |
| 5 | [docs/spec/PRODUCTION_HARDENING_ROADMAP.md](docs/spec/PRODUCTION_HARDENING_ROADMAP.md) | 8-week, 30-PR plan for taking this from its current state to quant-firm-production-grade. Week-4 CI gate already landed. |

Then dive into:

- [docs/adr/](docs/adr/) — six Architectural Decision Records: state-machine-vs-ReAct, layered extraction, deterministic fault injection, self-consistency validation, three-pronged locator, mandatory verifier.
- [prompts/](prompts/) — every prompt used by either task, with `## System` / `## User template` sections. Includes the LLM-powered free-text input parser for Task 2.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — full deploy walkthrough (Vercel + Railway/Zeabur + Supabase).

---

## What's in the repo

```
shared/                  LLM gateway, cost ledger, schemas, structured logging,
                         OpenTelemetry helper, pluggable artifact store
                         (filesystem / Supabase Storage)
task1_browser_agent/     Browser agent — agent/, api/, eval/ (with deterministic
                         fault-injection module for recovery proof)
task2_10k_extractor/     SEC 10-K extractor — pipeline/ (ingest → normalize →
                         L1 → L2 → L3 → confidence → calibration),
                         api/ (with LLM-powered free-text input parser),
                         eval/ (20 cases over 7 industries + pre-iXBRL)
web/                     Next.js 15 frontend — 5 pages: /, /task1, /task2,
                         /dashboard, /jobs/[id]
prompts/                 Versioned prompt templates (4 for Task 1 + 3 for Task 2)
docs/spec/               Original project spec (EN + ZH)
                         + PRODUCTION_HARDENING_ROADMAP.md (production roadmap)
docs/adr/                ADR-001 through ADR-006
docs/analysis/           Per-task perf / cost / scalability analysis
docs/VERIFICATION.md     Living verification checklist + full bug history
docs/DEPLOYMENT.md       Step-by-step prod deploy walkthrough
.github/workflows/ci.yml CI eval-regression gate + lint + typecheck + build
infra/                   Dockerfile, railway.json, zeabur.json, Procfile,
                         docker-compose.dev.yml, .env.production.example
```

---

## 📊 Top-line numbers (current eval baselines)

**Task 1 — Browser Agent** ([eval set, 15 cases over 6 categories](task1_browser_agent/eval/eval_set.yaml))

| Metric | Value |
|---|---|
| Pass rate | **11–14 / 15 (73–93%)** across consecutive runs (Gemini stochasticity at temp=0, see [task1_report §5.4](docs/analysis/task1_report.md)) |
| Recovery rate | 8–18% — including one observed **real-world** recovery (not just fault-injected) |
| Cost p50 / p95 | **$0.005 / $0.009** per task |
| Wall-time (p50) | ~25 s per case |
| Total eval wall-time | **~2 min** (parallel @ 4 — was 10 min serial) |
| Deterministic fault-injection recovery proof | ✅ `recovery-stale-locator-then-succeed` case |

**Task 2 — 10-K Item Extractor** ([eval set, 20 cases across 7 industries + 3 pre-iXBRL filings](task2_10k_extractor/eval/eval_set.yaml))

| Metric | Value |
|---|---|
| Pass rate | **19 / 20 (95%)** — the 1 fail is MSFT-2015 Item 8 (legitimately incorporated by reference; system refuses to fabricate) |
| Mean overall confidence | 0.896 (**Platt-calibrated** — ECE 0.056) |
| Mean required-item coverage | 95% |
| Cost per filing (median) | **$0.00** — L1+L2 covers every case |
| Wall-time (p50) | ~5 s per filing |
| Total eval wall-time | **~35 s** for all 20 (parallel @ 4) |

> ⚠️ **These are curated-eval numbers and do not generalize.** The 20 cases were selected for industry diversity *and the heading thresholds / calibration were tuned against them*. On a 25-ticker real-world sweep of untuned large-cap filers, mean confidence drops to **0.526** and only **68 %** keep all four substance items intact. See the row below.

**Task 2 — Real-world sweep** (25 untuned large-cap tickers, fetched live from EDGAR — [full writeup](docs/analysis/real_world_sweep.md))

| Metric | Value |
|---|---|
| Pipeline ran end-to-end (no error) | **25 / 25 (100%)** — never crashes, never returns zero items |
| Core-4 substance items extracted (1 / 1A / 7 / 8) | **17 / 25 (68%)** under their own heading; +2 (NVDA/NFLX) are legitimate Item 8 → Item 15 incorporation, leaving **8 genuinely broken** — vs ~95% on the curated set |
| Mean overall confidence | **0.526** (median 0.509) — vs 0.896 curated; calibration does not transfer |
| Quarantine rate | **8 / 25 (32%)** after the reliability fix ([ADR-007](docs/adr/ADR-007-structural-quarantine-gate.md)) — a hard structural gate flags every filing missing/truncating a core item (1/1A/7/8). **8/8 real failures caught, 0/17 false positives**, incl. Citi with its MD&A missing (was a silent pass before the fix). |
| Most common real failure | **Item 7 (MD&A), 5/8** — anchor mis-bounded or no recognisable heading |
| Incorporation handled | NVDA/NFLX Item 8 → Item 15 correctly classified as incorporation-by-reference, not failures (only when the statements are verifiably captured) |
| Cost per filing (median / max) | **$0.024 / $0.063** — real filings trigger L3; the structural gate itself adds zero LLM cost |

Both tasks' curated numbers are queried directly from `task{1,2}_browser_agent/eval/report.json` and the `cost_ledger` table — no estimation. The real-world sweep numbers come from [`tools/sweep_random_tickers.py`](tools/sweep_random_tickers.py) over a live EDGAR pull.

---

## 🏗 Design highlights

### Task 1 — Browser Agent

| Property | Where | Why this and not the obvious alternative |
|---|---|---|
| Explicit `PLAN → LOCATE → ACT → VERIFY → DIAGNOSE` state machine | [agent/state_machine.py](task1_browser_agent/agent/state_machine.py) | ReAct loops have unbounded cost and no failure attribution. See [ADR-001](docs/adr/ADR-001-state-machine-over-react.md). |
| Three-pronged locator probe (CSS → ARIA role+name → visible text) | [agent/executor.py](task1_browser_agent/agent/executor.py) | Single CSS selector is the #1 cause of brittle web agents. See [ADR-005](docs/adr/ADR-005-three-pronged-locator.md). |
| Mandatory verifier after every action | [agent/verifier.py](task1_browser_agent/agent/verifier.py) | "ACT didn't throw" ≠ "ACT achieved the goal." See [ADR-006](docs/adr/ADR-006-mandatory-verifier.md). |
| Recovery via typed `RecoveryStrategy` enum (RELOCATE / WAIT / REPLAN / ESCALATE / ABORT) | [agent/diagnoser.py](task1_browser_agent/agent/diagnoser.py) | "Naked retry" is not self-correction. Every recovery must articulate what changes on retry. |
| Failed selectors tracked per step + prong escalates + `selector_history` cache across sessions | [agent/state_machine.py](task1_browser_agent/agent/state_machine.py) + [shared/cost_ledger.py](shared/cost_ledger.py) | First v3 eval had recovery_rate=0% because the locator LLM kept proposing the same broken selector. Fixed with avoid-list + prong escalation; persistent `selector_history` table compounds first-try hit rate over time. |
| Domain allow-list enforced on every navigation | [agent/executor.py](task1_browser_agent/agent/executor.py) | Compliance / safety. |
| Deterministic fault injection for recovery proof | [eval/fault_injection.py](task1_browser_agent/eval/fault_injection.py) | Recovery only triggers on real failures — so "it works" can only be proven by accident. Fault injection makes the proof deterministic. See [ADR-003](docs/adr/ADR-003-deterministic-fault-injection.md). |

### Task 2 — 10-K Extractor

| Property | Where | Why this and not the obvious alternative |
|---|---|---|
| **Free-text input parser** — accepts any English / Chinese natural-language input (`"Apple 2024"`, `"微軟 年報"`, ticker, URL) | [api/router.py edgar_parse](task2_10k_extractor/api/router.py), [prompts/task2_10k/input_parser.md](prompts/task2_10k/input_parser.md) | Reviewers don't want to hand-craft EDGAR archive URLs. CHEAP-tier LLM (~$0.0001) interprets intent + emits typed `url` / `ticker_query` / `unsupported` / `refuse`. Foreign-filer 20-F → typed refusal; nonsense input → typed refusal. |
| **Full SEC ticker registry** (10,365 tickers) as fallback | [eval/edgar_lookup.py](task2_10k_extractor/eval/edgar_lookup.py) | KNOWN_CIKS only had 14 hand-curated tickers. Now any US-listed filer resolves automatically via SEC's public `company_tickers.json`. |
| Layered fallback: **L1** anchor → **L2** structural → **L3** LLM self-consistency → quarantine | [pipeline/orchestrator.py](task2_10k_extractor/pipeline/orchestrator.py) | A single LLM-everything pipeline costs ~$0.10–$0.50 per filing. Layered fallback costs $0 on the curated set and a real-world median of **$0.024** (L3 fires on most real filings; see [sweep](docs/analysis/real_world_sweep.md)) — still ~5–20× cheaper than LLM-everything. See [ADR-002](docs/adr/ADR-002-layered-extraction-pipeline.md). |
| **L1** anchor extractor: regex + density-based TOC + first-with-gap section heuristic | [pipeline/l1_anchor.py](task2_10k_extractor/pipeline/l1_anchor.py) | Most filings have proper heading anchors; we capture them deterministically. |
| **L2** structural extractor: TOC `<a href="#item7a">` → `<a name="item7a">` reverse-lookup | [pipeline/l2_structural.py](task2_10k_extractor/pipeline/l2_structural.py) | When L1 misses a heading (visual styling not in our tag set), the TOC link almost always points at the right anchor. |
| **L3** LLM self-consistency: two independent prompts per suspect item + boundary IoU + arbitration | [pipeline/l3_llm.py](task2_10k_extractor/pipeline/l3_llm.py) | Without a public ground truth, the only honest self-validation is two independent extractions agreeing. See [ADR-004](docs/adr/ADR-004-self-consistency-validation.md). |
| **Trained Platt calibration** — ECE 0.056 on 192 synthetic labels auto-bootstrapped from the eval baseline | [pipeline/calibration.py](task2_10k_extractor/pipeline/calibration.py), [eval/bootstrap_calibration.py](task2_10k_extractor/eval/bootstrap_calibration.py) | Raw confidence is a useful ordering but not a probability. Labels are synthetic (rule-based), provenance transparently noted in `labels.provenance.json` — replace with human grading for true production calibration. |
| Confidence as 25th-percentile over REQUIRED items (not min, not mean) | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | `min` crashes overall to 0 on a legitimately-empty `Item 6 [Reserved]`. `mean` masks systemic problems. `p25` is robust to one outlier but still fails loud on systemic issues. |
| Per-item floor only applied to REQUIRED items | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | Items 1B, 6, 9B, 9C, 16 are commonly empty by design — penalising them generates false positives. |
| Quarantine threshold 0.45 + `quarantined=true` surfaced in API + UI | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | "Fail loud, never silent": a low-confidence output is flagged, not emitted as if certain. |
| **Concrete capability matrix exposed in UI** — 8 eval-proven filings + 1 known failure case + 4 typed-refusal categories | [dashboard `#task2-capabilities`](https://whaleforce-llm-test.vercel.app/dashboard#task2-capabilities) | The spec asks for clear lists of supported / problematic filings with examples. Dashboard surfaces all of this, with deep-link from `/task2` page. |

### Shared backbone (both tasks)

| Component | Why |
|---|---|
| **LLM Gateway** ([shared/llm_gateway.py](shared/llm_gateway.py)) | Single entrypoint, pluggable backend (`anthropic` / `openai` / `gemini` / `mock`), tier-based model routing (CHEAP / DEFAULT / PREMIUM), mandatory cost attribution before return, tenacity retry with `LLMUnavailableError` (503/429) distinguished from other errors. Anthropic prompt caching when supported. **Mock backend** lets CI run the eval gate at zero cost. |
| **Cost Ledger** ([shared/cost_ledger.py](shared/cost_ledger.py)) | Every LLM call writes one row before the response returns. Analysis reports query this table directly, never estimate. Aggregations exposed via `/task1/dashboard/cost-summary` (by purpose, by model). Schema uses `TIMESTAMP WITH TIME ZONE` (UTC) — discovered during initial Supabase deploy. |
| **`selector_history`** ([shared/cost_ledger.py](shared/cost_ledger.py)) | Per-(site, target_signature, primary_selector) success/failure counter persisted across sessions; locator prompt receives previously-working selectors as a "KNOWN-GOOD" hint. Compounds first-try hit rate over time. |
| **Strongly-typed Pydantic schemas** ([shared/schemas.py](shared/schemas.py)) | Every cross-process / persisted record carries `schema_version: "1.0.0"`. Breaking changes go through a v2 type, never silent mutation. |
| **Structured logging** ([shared/logging.py](shared/logging.py)) | structlog JSON / dev-text. Trace id carried via contextvars. No bare `print()` in any production code path. |
| **OpenTelemetry** ([shared/otel.py](shared/otel.py)) | `OTEL_ENABLED=true` wires `TracerProvider` + `FastAPIInstrumentor` + console exporter fallback. Real OTLP endpoint ships to Honeycomb / Tempo / Jaeger when configured. |
| **Artifact store** ([shared/artifacts.py](shared/artifacts.py)) | `ARTIFACT_BACKEND=local` writes filesystem; `ARTIFACT_BACKEND=supabase` uploads via the REST API. Same `put_artifact` / `get_artifact` interface either way. |
| **Observability via `/dashboard`** | KPI tiles + eval table + cost-by-purpose + cost-by-model + recent jobs + Task 1 capability matrix + Task 2 capability matrix (proven filings, known failures, typed-refusal categories). Every row is clickable → drills into the failure inspector. |

---

## 🚀 Quick start (run locally)

### Prerequisites

- Python ≥ 3.11
- Node ≥ 20 (Next 15 needs it; conda's bundled Node 11 is too old)
- One of: an Anthropic / OpenAI / Gemini API key. **Gemini is the default** — free tier sufficient (this entire project's dev cost across hundreds of calls is < $1).

### Backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium

cp .env.example .env
# Edit .env → set GEMINI_API_KEY (or LLM_BACKEND=anthropic + ANTHROPIC_API_KEY)

uvicorn task1_browser_agent.api.main:app --reload --port 8000
```

### Frontend

```bash
cd web
PATH=/usr/local/bin:$PATH npm install --legacy-peer-deps
PATH=/usr/local/bin:$PATH npm run dev   # → http://localhost:3000
```

The `PATH=` prefix is needed if a conda Python is your default. Find a `node` ≥ 20 (`brew install node` or `nvm install 20`).

### Run the evals

```bash
# Task 1 — 15 cases, parallel @ 4, ~2 min, ~$0.07
python -m task1_browser_agent.eval.runner --concurrency 4

# Task 2 — 20 cases, parallel @ 4, ~35 s, ~$0 (L1+L2 covers everything)
python -m task2_10k_extractor.eval.runner --concurrency 4
```

Reports land in `task{1,2}_browser_agent/eval/report.json`. The dashboard reads them.

### Expand the Task 2 eval set against current SEC EDGAR data

```bash
python -m task2_10k_extractor.eval.edgar_lookup --build-eval-set --output /tmp/expanded.yaml
```

This calls `data.sec.gov/submissions/CIK{cik}.json` for every ticker in `KNOWN_CIKS`, picks the most recent 10-K, and emits an `eval_set.yaml`-compatible block. Historical filings beyond the `recent` block are also resolvable (pre-2017 paginated submissions).

### Bootstrap & retrain confidence calibration

```bash
# Run the full eval, derive synthetic labels, fit Platt, persist params
python -m task2_10k_extractor.eval.bootstrap_calibration train

python -m task2_10k_extractor.pipeline.calibration status
# → shows a, b, n_train, ECE, Brier
```

---

## ☁️ Deployment

The full step-by-step is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Short version:

| Tier | Where | Config |
|---|---|---|
| Frontend (Next.js) | Vercel | [`web/vercel.json`](web/vercel.json) — set `NEXT_PUBLIC_API_URL` to the backend URL |
| Backend (FastAPI + Playwright + Chromium) | Railway (or Zeabur / Fly) — **not Vercel** (no long-running Playwright there) | [`infra/Dockerfile`](infra/Dockerfile) + [`railway.json`](railway.json) + [`infra/zeabur.json`](infra/zeabur.json) + [`infra/Procfile`](infra/Procfile) |
| Database | Supabase (Postgres) | `DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<pw>@<pooler>:5432/postgres` |
| Artifact storage | Supabase Storage | `ARTIFACT_BACKEND=supabase` + `SUPABASE_*` (full REST backend in [`shared/artifacts.py`](shared/artifacts.py)) |

Backend env-var template: [`infra/.env.production.example`](infra/.env.production.example).

**CI/CD** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): every push to `main` and every PR is gated by:

- Python lint + whole-codebase syntax check
- Backend startup smoke test (FastAPI app responds to `/task1/health` and `/task2/health` within 30 s)
- **Task 2 eval regression gate** (mock LLM backend, $0 cost, deterministic, fails if pass-rate drops > 2 pp vs the committed baseline)
- Next.js TypeScript typecheck + production build

No CI secrets required — the mock backend keeps everything free and reproducible.

---

## 🤖 AI collaboration record

Every prompt the system uses is in [prompts/](prompts/):

- **Task 1** — [planner](prompts/task1_browser/planner.md), [locator](prompts/task1_browser/locator.md), [verifier](prompts/task1_browser/verifier.md), [diagnoser](prompts/task1_browser/diagnoser.md)
- **Task 2** — [input_parser (free-text → intent)](prompts/task2_10k/input_parser.md), [extractor_a (per-item)](prompts/task2_10k/extractor_a.md), [extractor_b (whole-chunk)](prompts/task2_10k/extractor_b.md)

These were iterated on with Claude as the primary AI collaborator. The full bug-history-with-fixes is in [docs/VERIFICATION.md](docs/VERIFICATION.md), which is the most honest read of how the system evolved (16 sections, 16+ documented bugs each with root cause + fix).

---

## 🔭 Honest limitations (read before grading)

1. **Task 1 eval is small** (15 cases) and run-to-run pass rate varies **11–14/15** from Gemini stochasticity at `temperature=0`. The system reports the range honestly rather than the best run. Documented in [task1_report §5.4](docs/analysis/task1_report.md).
2. **Task 2 L3 is conservative** — boundary IoU threshold of 500 chars over a 12 KB chunk is tight. It currently provides arbitration, not aggressive replacement. This is by design ("no silent override") but means hard cases get quarantined rather than fixed by L3.
3. **Confidence calibration uses synthetic labels** (rule-based bootstrap from the eval baseline). ECE 0.056 is good but should be re-validated against ~20 human-graded examples for true production deployment. The `labels.provenance.json` sidecar makes this honest.
4. **One known failure case** (MSFT FY2015 Item 8) — pre-iXBRL filing incorporates Item 8 entirely by reference. System correctly quarantines rather than fabricates. Documented on the [Task 2 capability matrix](https://whaleforce-llm-test.vercel.app/dashboard#task2-capabilities).
5. **No CAPTCHA / Cloudflare / authenticated-session handling** in Task 1. Compliance choice; agent always escalates.
6. **In-memory job stores** for live (non-eval) jobs. After a backend redeploy, in-flight job IDs return 404 from the inspector. PRODUCTION_HARDENING_ROADMAP Week 2 (Alembic + persistent stores) addresses this.
7. **Cross-year consistency check** (the fourth confidence signal in PLAN §3.5 w₄) is designed but not implemented. Requires multi-year ingest pipeline; planned in roadmap.
8. **No human-in-the-loop review queue** for quarantined Task 2 extractions yet — they are flagged but not assignable. Planned in roadmap Week 7.

---

## 🛣 Where to take this next

[`docs/spec/PRODUCTION_HARDENING_ROADMAP.md`](docs/spec/PRODUCTION_HARDENING_ROADMAP.md) is the 8-week, 30-PR working spec for taking this from its current build to a system a professional quantitative firm could adopt. Each PR has a goal, deliverables list, and acceptance criteria; the roadmap also commits to 12 binary criteria for "production-ready" and 8 SLOs to negotiate with customers once Week 6 lands.

**Week 4 (CI eval gate, PR-401) has already landed** as proof the roadmap is real, not aspirational. The next PR per the roadmap is Week 1 PR-101: API key authentication via FastAPI middleware.
