"""Task 7 API — relative-strength agent. Same in-memory job pattern as Task 3/4/5/6."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task7_relative.pipeline.orchestrator import (
    TickerNotFound,
    new_job_id,
    run_relative_pipeline,
)
from task7_relative.schemas import Task7Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task7", tags=["task7"])

_JOBS: dict[str, Task7Job] = {}
_JOB_TIMEOUT_S = 150.0


class CreateRelativeBody(BaseModel):
    ticker: str


@router.post("/relatives", response_model=Task7Job)
async def create_relative(body: CreateRelativeBody) -> Task7Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task7Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING,
                   created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/relatives", response_model=list[Task7Job])
async def list_relatives() -> list[Task7Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/relatives/{job_id}", response_model=Task7Job)
async def get_relative(job_id: str) -> Task7Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "relative-strength job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task7-relative"}


async def _run(job: Task7Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_relative_pipeline(ticker=job.ticker, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (price fetches + LLM + backtest). "
            f"The backend may be slow or Yahoo is throttling — please retry."
        )
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task7_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
