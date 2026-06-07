"""Task 6 API — insider (Form 4) agent. Same in-memory job pattern as Task 3/4/5."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task6_insider.pipeline.orchestrator import (
    TickerNotFound,
    new_job_id,
    run_insider_pipeline,
)
from task6_insider.schemas import Task6Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task6", tags=["task6"])

_JOBS: dict[str, Task6Job] = {}
_JOB_TIMEOUT_S = 180.0   # Form 4 fetch (many SEC requests) + LLM + backtest


class CreateInsiderBody(BaseModel):
    ticker: str


@router.post("/insiders", response_model=Task6Job)
async def create_insider(body: CreateInsiderBody) -> Task6Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task6Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING,
                   created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/insiders", response_model=list[Task6Job])
async def list_insiders() -> list[Task6Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/insiders/{job_id}", response_model=Task6Job)
async def get_insider(job_id: str) -> Task6Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "insider job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task6-insider"}


async def _run(job: Task6Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_insider_pipeline(ticker=job.ticker, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (Form 4 fetch + LLM + backtest). "
            f"The backend may be slow or SEC/Yahoo is throttling — please retry."
        )
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task6_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
