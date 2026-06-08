"""Task 27 API — 八字 PLACEBO agent."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task27_bazi.pipeline.orchestrator import TickerNotFound, new_job_id, run_bazi_pipeline
from task27_bazi.schemas import Task27Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task27", tags=["task27"])
_JOBS: dict[str, Task27Job] = {}
_JOB_TIMEOUT_S = 120.0


class CreateBody(BaseModel):
    ticker: str


@router.post("/bazi", response_model=Task27Job)
async def create(body: CreateBody) -> Task27Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task27Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/bazi", response_model=list[Task27Job])
async def list_jobs() -> list[Task27Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/bazi/{job_id}", response_model=Task27Job)
async def get_job(job_id: str) -> Task27Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "bazi job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task27-bazi", "kind": "control-placebo"}


async def _run(job: Task27Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_bazi_pipeline(ticker=job.ticker, job_id=job.job_id), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task27_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
