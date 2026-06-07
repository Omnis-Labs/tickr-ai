"""Task 26 API — 梅花易數 PLACEBO agent."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task26_meihua.pipeline.orchestrator import TickerNotFound, new_job_id, run_meihua_pipeline
from task26_meihua.schemas import Task26Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task26", tags=["task26"])
_JOBS: dict[str, Task26Job] = {}
_JOB_TIMEOUT_S = 120.0


class CreateBody(BaseModel):
    ticker: str


@router.post("/meihua", response_model=Task26Job)
async def create(body: CreateBody) -> Task26Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task26Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/meihua", response_model=list[Task26Job])
async def list_jobs() -> list[Task26Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/meihua/{job_id}", response_model=Task26Job)
async def get_job(job_id: str) -> Task26Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "meihua job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task26-meihua", "kind": "control-placebo"}


async def _run(job: Task26Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_meihua_pipeline(ticker=job.ticker, job_id=job.job_id), timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task26_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
