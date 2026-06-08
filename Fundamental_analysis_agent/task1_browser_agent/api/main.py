"""Task 1 — FastAPI app.

Endpoints:
  POST /task1/jobs              create + start a job
  GET  /task1/jobs/{id}         current job state (steps, plan, cost, status)
  GET  /task1/jobs/{id}/events  SSE stream of live step events
  GET  /task1/jobs              recent jobs (list)
  GET  /task1/health            liveness
  GET  /task1/capabilities      static capability matrix per supported site

Run locally:
    uvicorn task1_browser_agent.api.main:app --reload
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from shared.config import get_settings
from shared.cost_ledger import cost_summary, init_db
from shared.logging import configure_logging, get_logger
from shared.otel import setup_otel
from shared.schemas import Task1Job

from task1_browser_agent.agent.state_machine import AgentRunner
from task1_browser_agent.api.job_store import store
from task2_10k_extractor.api.router import router as task2_router
from task3_strategy.api.router import router as task3_router
from task4_technical.api.router import router as task4_router
from task5_ensemble.api.router import router as task5_router
from task6_insider.api.router import router as task6_router
from task7_relative.api.router import router as task7_router
from task8_earnings.api.router import router as task8_router
from task9_institutional.api.router import router as task9_router
from task10_portfolio.api.router import router as task10_router
from task11_fundamentals_trend.api.router import router as task11_router
from task12_seasonality.api.router import router as task12_router
from task13_overnight.api.router import router as task13_router
from task14_volatility.api.router import router as task14_router
from task15_buyback.api.router import router as task15_router
from task16_short.api.router import router as task16_router
from task17_quality.api.router import router as task17_router
from task18_events.api.router import router as task18_router
from task19_anomaly.api.router import router as task19_router
from task20_vix.api.router import router as task20_router
from task21_ranker.api.router import router as task21_router
from task22_congress.api.router import router as task22_router
from task23_pairs.api.router import router as task23_router
from task24_contagion.api.router import router as task24_router
from task25_astro.api.router import router as task25_router
from task26_meihua.api.router import router as task26_router
from task27_bazi.api.router import router as task27_router
from task28_ziwei.api.router import router as task28_router
from task29_suimei.api.router import router as task29_router
from task30_qizheng.api.router import router as task30_router
from task31_tieban.api.router import router as task31_router

configure_logging()
logger = get_logger(__name__)

settings = get_settings()

app = FastAPI(title="Fundamental Analysis Agent — Task 1-31 (24 signals + 7 placebo controls)", version="1.12.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(task2_router)
app.include_router(task3_router)
app.include_router(task4_router)
app.include_router(task5_router)
app.include_router(task6_router)
app.include_router(task7_router)
app.include_router(task8_router)
app.include_router(task9_router)
app.include_router(task10_router)
app.include_router(task11_router)
app.include_router(task12_router)
app.include_router(task13_router)
app.include_router(task14_router)
app.include_router(task15_router)
app.include_router(task16_router)
app.include_router(task17_router)
app.include_router(task18_router)
app.include_router(task19_router)
app.include_router(task20_router)
app.include_router(task21_router)
app.include_router(task22_router)
app.include_router(task23_router)
app.include_router(task24_router)
app.include_router(task25_router)
app.include_router(task26_router)
app.include_router(task27_router)
app.include_router(task28_router)
app.include_router(task29_router)
app.include_router(task30_router)
app.include_router(task31_router)


@app.on_event("startup")
async def on_startup() -> None:
    await init_db()
    otel_active = setup_otel(app)
    logger.info("api_startup", backend=settings.llm_backend, otel=otel_active)


class CreateJobBody(BaseModel):
    task_description: str = Field(min_length=3, max_length=2000)


@app.get("/task1/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "llm_backend": settings.llm_backend}


@app.get("/task1/capabilities")
async def capabilities() -> dict[str, object]:
    return {
        "supported_sites": [
            {
                "domain": "wikipedia.org",
                "operations": ["search article", "extract section text", "follow internal links"],
                "notes": "Stable DOM; good baseline for planner & verifier.",
            },
            {
                "domain": "arxiv.org",
                "operations": ["search papers", "extract abstract / authors", "browse listings"],
                "notes": "Lightweight HTML; works well.",
            },
            {
                "domain": "news.ycombinator.com",
                "operations": ["read front page", "open story", "extract comments"],
                "notes": "Minimal JS; ideal for verifier sanity.",
            },
            {
                "domain": "httpbin.org",
                "operations": ["form-fill demos", "GET/POST inspections"],
                "notes": "Used for synthetic eval cases.",
            },
        ],
        "unsupported_or_unreliable": [
            {"pattern": "any site requiring login", "reason": "Agent always ESCALATES on auth walls — compliance choice."},
            {"pattern": "sites behind CAPTCHA / Cloudflare interactive", "reason": "Same."},
            {"pattern": "infinite-scroll feeds (TikTok, X)", "reason": "Verifier struggles to declare success; not yet handled."},
            {"pattern": "SPAs with custom routing (Gmail, Notion)", "reason": "MVP planner targets static-ish navigation."},
        ],
        "allow_list": settings.allowed_domains,
    }


EVAL_REPORT_PATH = (
    Path(__file__).resolve().parents[1] / "eval" / "report.json"
)
EVAL_JOBS_DIR = Path(__file__).resolve().parents[1] / "eval" / "jobs"
ARTIFACTS_DIR = Path(settings.artifact_dir).resolve()


@app.get("/task1/dashboard/eval")
async def dashboard_eval() -> dict:
    """Surface the latest eval report. Returns metrics + per-case outcomes.

    If no eval has been run yet, returns `{"available": false}` rather than
    erroring — the frontend handles this state.
    """
    if not EVAL_REPORT_PATH.exists():
        return {"available": False, "reason": "no report.json yet — run `python -m task1_browser_agent.eval.runner`"}
    try:
        data = json.loads(EVAL_REPORT_PATH.read_text(encoding="utf-8"))
        data["available"] = True
        return data
    except Exception as e:  # noqa: BLE001
        logger.exception("dashboard_eval_read_failed", error=str(e))
        return {"available": False, "reason": f"could not parse report: {e}"}


@app.get("/task1/dashboard/cost-summary")
async def dashboard_cost_summary() -> dict:
    """All-time cost ledger aggregation. Cheap query, fine to poll."""
    return await cost_summary()


@app.get("/task1/dashboard/recent-jobs")
async def dashboard_recent_jobs(limit: int = 10) -> list[dict]:
    """Last N jobs from the in-memory store, lightweight projection."""
    jobs = store.list_recent(limit=max(1, min(50, limit)))
    return [
        {
            "job_id": j.job_id,
            "task_description": j.task_description[:120],
            "status": j.status.value,
            "n_steps": len(j.steps),
            "recovery_attempts": j.recovery_attempts,
            "total_cost_usd": j.total_cost_usd,
            "created_at": j.created_at.isoformat(),
            "updated_at": j.updated_at.isoformat(),
        }
        for j in jobs
    ]


@app.post("/task1/jobs", response_model=Task1Job)
async def create_job(body: CreateJobBody) -> Task1Job:
    job = await store.create(task_description=body.task_description)
    asyncio.create_task(_run_job(job))
    return job


@app.get("/task1/jobs", response_model=list[Task1Job])
async def list_jobs() -> list[Task1Job]:
    return store.list_recent()


@app.get("/task1/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    """Returns a job by id. Looks in:
      1. In-memory store (live jobs from /task1 UI).
      2. Eval sidecar directory (jobs persisted by `python -m task1_browser_agent.eval.runner`).
    Sidecar response includes the eval case context (case id, assertions,
    pass/fail reason) under `eval_metadata`.
    """
    job = store.get(job_id)
    if job:
        return {"job": job.model_dump(mode="json"), "source": "memory"}
    # Try the eval sidecar directory
    sidecar = EVAL_JOBS_DIR / f"{job_id}.json"
    if sidecar.exists():
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        return {
            "job": data["job"],
            "source": "eval_sidecar",
            "eval_metadata": {
                "case_id": data.get("eval_case_id"),
                "passed": data.get("eval_passed"),
                "failure_reason": data.get("eval_failure_reason"),
                "assertions": data.get("eval_assertions"),
                "fault_inject": data.get("fault_inject"),
                "fault_status": data.get("fault_status"),
            },
        }
    raise HTTPException(404, "job not found in memory or eval sidecars")


@app.get("/task1/jobs/by-case/{case_id}")
async def get_job_by_case(case_id: str) -> dict:
    """Look up the job_id for an eval case (latest run)."""
    pointer = EVAL_JOBS_DIR / f"by-id-{case_id}.json"
    if not pointer.exists():
        raise HTTPException(404, "no eval run found for this case_id")
    data = json.loads(pointer.read_text(encoding="utf-8"))
    return data


@app.get("/task1/artifacts/{job_id}/{filename}")
async def get_artifact_file(job_id: str, filename: str):
    """Serve a single artifact file (screenshot or DOM snapshot).

    Path is double-segment to constrain inputs — `..` in either segment is
    rejected so callers cannot escape the artifact dir.
    """
    from fastapi.responses import FileResponse

    if ".." in job_id or "/" in job_id or ".." in filename or "/" in filename:
        raise HTTPException(400, "invalid path component")
    target = (ARTIFACTS_DIR / job_id / filename).resolve()
    if not str(target).startswith(str(ARTIFACTS_DIR)):
        raise HTTPException(400, "path escapes artifact root")
    if not target.exists():
        raise HTTPException(404, f"artifact not found: {job_id}/{filename}")
    # Set caching header so the browser doesn't re-fetch screenshots constantly
    return FileResponse(target, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/task1/jobs/{job_id}/events")
async def stream_events(job_id: str) -> EventSourceResponse:
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")

    async def gen() -> AsyncIterator[dict[str, str]]:
        async for ev in store.stream(job_id):
            yield {"event": "step", "data": ev.model_dump_json()}
        # final snapshot for clients that connected late
        final = store.get(job_id)
        if final:
            yield {"event": "done", "data": final.model_dump_json()}

    return EventSourceResponse(gen())


async def _run_job(job: Task1Job) -> None:
    runner = AgentRunner(job)
    try:
        async for ev in runner.run():
            await store.push_event(job.job_id, ev)
    except Exception as e:  # noqa: BLE001
        logger.exception("job_crashed", job_id=job.job_id, error=str(e))
        from shared.schemas import AgentState, JobStatus, Task1StepEvent
        from datetime import datetime, timezone

        job.status = JobStatus.FAILED
        await store.push_event(
            job.job_id,
            Task1StepEvent(
                job_id=job.job_id,
                sequence=10_000,
                state=AgentState.ESCALATE,
                message=f"Unhandled crash: {e}",
                timestamp=datetime.now(timezone.utc),
            ),
        )
    finally:
        await store.close(job.job_id)
