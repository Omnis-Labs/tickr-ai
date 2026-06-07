"""Task 16 API — short-pressure agent."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task16_short.pipeline.orchestrator import TickerNotFound, new_job_id, run_short_pipeline
from task16_short.schemas import Task16Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task16", tags=["task16"])
_JOBS: dict[str, Task16Job] = {}
_JOB_TIMEOUT_S = 200.0   # first run fetches ~weekly FINRA files (then cached)


class CreateBody(BaseModel):
    ticker: str


@router.post("/short", response_model=Task16Job)
async def create(body: CreateBody) -> Task16Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. GME)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task16Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/short", response_model=list[Task16Job])
async def list_jobs() -> list[Task16Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/short/{job_id}", response_model=Task16Job)
async def get_job(job_id: str) -> Task16Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "short job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task16-short"}


async def _run(job: Task16Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(run_short_pipeline(ticker=job.ticker, job_id=job.job_id), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s (first run fetches FINRA files; retry — it caches)."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task16_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
