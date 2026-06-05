"""Task 3 API — fundamentals-driven strategy lab.

Mirrors the Task 2 in-memory job pattern: POST creates a job and kicks off an
async run; GET polls. No DB — jobs live for the process lifetime, same as Task 2.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task3_strategy.pipeline.orchestrator import (
    QuarantineRefusal,
    TickerNotFound,
    new_job_id,
    run_strategy_pipeline,
)
from task3_strategy.schemas import Task3Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task3", tags=["task3"])

_JOBS: dict[str, Task3Job] = {}


class CreateStrategyBody(BaseModel):
    ticker: str


@router.post("/strategies", response_model=Task3Job)
async def create_strategy(body: CreateStrategyBody) -> Task3Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task3Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING,
                   created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/strategies", response_model=list[Task3Job])
async def list_strategies() -> list[Task3Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/strategies/{job_id}", response_model=Task3Job)
async def get_strategy(job_id: str) -> Task3Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "strategy job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task3-strategy"}


_JOB_TIMEOUT_S = 150.0


async def _run(job: Task3Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_strategy_pipeline(ticker=job.ticker, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (10-K extraction + price fetch + "
            f"backtest). The backend may be slow or Yahoo Finance is throttling — please retry."
        )
    except QuarantineRefusal as e:
        # Honest refusal: the 10-K extraction wasn't trustworthy (ADR-007).
        job.status = JobStatus.QUARANTINED
        job.error_message = str(e)
    except TickerNotFound as e:
        # User input error, not a crash — surface a clean message, no class prefix.
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task3_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
