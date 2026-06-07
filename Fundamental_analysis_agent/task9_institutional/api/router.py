"""Task 9 API — institutional / 13F agent. Same in-memory job pattern as the others."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task9_institutional.pipeline.orchestrator import (
    TickerNotFound,
    new_job_id,
    run_institutional_pipeline,
)
from task9_institutional.schemas import Task9Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task9", tags=["task9"])

_JOBS: dict[str, Task9Job] = {}
_JOB_TIMEOUT_S = 220.0   # many funds × many 13Fs of SEC fetches + LLM + backtest


class CreateInstitutionalBody(BaseModel):
    ticker: str


@router.post("/institutional", response_model=Task9Job)
async def create_institutional(body: CreateInstitutionalBody) -> Task9Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task9Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING,
                   created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/institutional", response_model=list[Task9Job])
async def list_institutional() -> list[Task9Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/institutional/{job_id}", response_model=Task9Job)
async def get_institutional(job_id: str) -> Task9Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "institutional job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task9-institutional"}


async def _run(job: Task9Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_institutional_pipeline(ticker=job.ticker, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (13F fetch across funds + LLM + backtest). "
            f"The backend may be slow or SEC is throttling — please retry."
        )
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task9_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
