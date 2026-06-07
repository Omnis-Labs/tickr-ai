"""Task 18 API — corporate-events agent."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task18_events.pipeline.orchestrator import TickerNotFound, new_job_id, run_events_pipeline
from task18_events.schemas import Task18Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task18", tags=["task18"])
_JOBS: dict[str, Task18Job] = {}
_JOB_TIMEOUT_S = 180.0


class CreateBody(BaseModel):
    ticker: str


@router.post("/events", response_model=Task18Job)
async def create(body: CreateBody) -> Task18Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. BHC)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task18Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/events", response_model=list[Task18Job])
async def list_jobs() -> list[Task18Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/events/{job_id}", response_model=Task18Job)
async def get_job(job_id: str) -> Task18Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "events job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task18-events"}


async def _run(job: Task18Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(run_events_pipeline(ticker=job.ticker, job_id=job.job_id), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task18_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
