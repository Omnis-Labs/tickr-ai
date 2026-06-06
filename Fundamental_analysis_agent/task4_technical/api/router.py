"""Task 4 API — technical-analysis-driven strategy lab.

Mirrors the Task 2 / Task 3 in-memory job pattern: POST creates a job and kicks
off an async run; GET polls. No DB — jobs live for the process lifetime.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task4_technical.pipeline.orchestrator import (
    TickerNotFound,
    new_job_id,
    run_technical_pipeline,
)
from task4_technical.schemas import Task4Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task4", tags=["task4"])

_JOBS: dict[str, Task4Job] = {}


class CreateAnalysisBody(BaseModel):
    ticker: str


@router.post("/analyses", response_model=Task4Job)
async def create_analysis(body: CreateAnalysisBody) -> Task4Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task4Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING,
                   created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/analyses", response_model=list[Task4Job])
async def list_analyses() -> list[Task4Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/analyses/{job_id}", response_model=Task4Job)
async def get_analysis(job_id: str) -> Task4Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "analysis job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task4-technical"}


_JOB_TIMEOUT_S = 120.0


async def _run(job: Task4Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_technical_pipeline(ticker=job.ticker, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (price fetch + backtest). The backend "
            f"may be slow or Yahoo Finance is throttling — please retry."
        )
    except TickerNotFound as e:
        # User input error, not a crash — surface a clean message, no class prefix.
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task4_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
