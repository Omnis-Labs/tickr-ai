"""Task 15 API — buyback agent."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task15_buyback.pipeline.orchestrator import TickerNotFound, new_job_id, run_buyback_pipeline
from task15_buyback.schemas import Task15Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task15", tags=["task15"])
_JOBS: dict[str, Task15Job] = {}
_JOB_TIMEOUT_S = 150.0


class CreateBody(BaseModel):
    ticker: str


@router.post("/buyback", response_model=Task15Job)
async def create(body: CreateBody) -> Task15Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task15Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/buyback", response_model=list[Task15Job])
async def list_jobs() -> list[Task15Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/buyback/{job_id}", response_model=Task15Job)
async def get_job(job_id: str) -> Task15Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "buyback job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task15-buyback"}


async def _run(job: Task15Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(run_buyback_pipeline(ticker=job.ticker, job_id=job.job_id), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task15_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
