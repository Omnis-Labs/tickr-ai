"""Task 25 API — financial-astrology PLACEBO agent."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task25_astro.pipeline.orchestrator import TickerNotFound, new_job_id, run_astro_pipeline
from task25_astro.schemas import Task25Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task25", tags=["task25"])
_JOBS: dict[str, Task25Job] = {}
_JOB_TIMEOUT_S = 120.0


class CreateBody(BaseModel):
    ticker: str


@router.post("/astro", response_model=Task25Job)
async def create(body: CreateBody) -> Task25Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task25Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/astro", response_model=list[Task25Job])
async def list_jobs() -> list[Task25Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/astro/{job_id}", response_model=Task25Job)
async def get_job(job_id: str) -> Task25Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "astro job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task25-astro", "kind": "control-placebo"}


async def _run(job: Task25Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_astro_pipeline(ticker=job.ticker, job_id=job.job_id), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task25_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
