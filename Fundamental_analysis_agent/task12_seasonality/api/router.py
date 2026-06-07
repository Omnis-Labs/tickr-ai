"""Task 12 API — seasonality agent. Same in-memory job pattern as the others."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task12_seasonality.pipeline.orchestrator import TickerNotFound, new_job_id, run_seasonal_pipeline
from task12_seasonality.schemas import Task12Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task12", tags=["task12"])
_JOBS: dict[str, Task12Job] = {}
_JOB_TIMEOUT_S = 120.0


class CreateBody(BaseModel):
    ticker: str


@router.post("/seasonality", response_model=Task12Job)
async def create(body: CreateBody) -> Task12Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task12Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/seasonality", response_model=list[Task12Job])
async def list_jobs() -> list[Task12Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/seasonality/{job_id}", response_model=Task12Job)
async def get_job(job_id: str) -> Task12Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "seasonality job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task12-seasonality"}


async def _run(job: Task12Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(run_seasonal_pipeline(ticker=job.ticker, job_id=job.job_id),
                                            timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task12_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
