"""Task 5 API — ensemble / multi-agent arbitration.

Same in-memory job pattern as Task 3/4: POST creates a job and kicks off an
async run; GET polls. No DB — jobs live for the process lifetime.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task5_ensemble.pipeline.orchestrator import (
    TickerNotFound,
    new_job_id,
    run_ensemble_pipeline,
)
from task5_ensemble.schemas import Task5Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task5", tags=["task5"])

_JOBS: dict[str, Task5Job] = {}

# Two LLM legs + an arbiter + (sometimes) a full 10-K extraction → give it more
# headroom than the single-agent tasks.
_JOB_TIMEOUT_S = 200.0


class CreateEnsembleBody(BaseModel):
    ticker: str


@router.post("/ensembles", response_model=Task5Job)
async def create_ensemble(body: CreateEnsembleBody) -> Task5Job:
    ticker = (body.ticker or "").strip().upper()
    if not ticker or len(ticker) > 12:
        raise HTTPException(400, "ticker required (e.g. AAPL)")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task5Job(job_id=job_id, ticker=ticker, status=JobStatus.PENDING,
                   created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/ensembles", response_model=list[Task5Job])
async def list_ensembles() -> list[Task5Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/ensembles/{job_id}", response_model=Task5Job)
async def get_ensemble(job_id: str) -> Task5Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "ensemble job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task5-ensemble"}


async def _run(job: Task5Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_ensemble_pipeline(ticker=job.ticker, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (two agents + 10-K extraction + arbiter "
            f"+ backtests). The backend may be slow or Yahoo Finance is throttling — please retry."
        )
    except TickerNotFound as e:
        # User input error, not a crash — clean message, no class prefix.
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task5_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
