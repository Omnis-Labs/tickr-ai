"""Task 8 API — earnings-release agent. Same in-memory job pattern as the others."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task8_earnings.pipeline.orchestrator import (
    TickerNotFound,
    new_job_id,
    run_earnings_pipeline,
)
from task8_earnings.schemas import Task8Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task8", tags=["task8"])

_JOBS: dict[str, Task8Job] = {}
_JOB_TIMEOUT_S = 180.0


class CreateEarningsBody(BaseModel):
    ticker: str


@router.post("/earnings", response_model=Task8Job)
async def create_earnings(body: CreateEarningsBody) -> Task8Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task8Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING,
                   created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/earnings", response_model=list[Task8Job])
async def list_earnings() -> list[Task8Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/earnings/{job_id}", response_model=Task8Job)
async def get_earnings(job_id: str) -> Task8Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "earnings job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task8-earnings"}


async def _run(job: Task8Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_earnings_pipeline(ticker=job.ticker, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (8-K fetch + classify + backtest). "
            f"The backend may be slow or SEC/Yahoo is throttling — please retry."
        )
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task8_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
