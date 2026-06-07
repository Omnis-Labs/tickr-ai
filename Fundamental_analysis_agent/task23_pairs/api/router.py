"""Task 23 API — pairs-trading agent. In-memory job pattern; input is two tickers."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task23_pairs.pipeline.orchestrator import TickerNotFound, new_job_id, run_pairs_pipeline
from task23_pairs.schemas import Task23Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task23", tags=["task23"])
_JOBS: dict[str, Task23Job] = {}
_JOB_TIMEOUT_S = 120.0


class CreateBody(BaseModel):
    tickers: str   # exactly two, comma/space-separated, e.g. "KO, PEP"


def _parse(raw: str) -> list[str]:
    return [t.upper() for t in re.split(r"[,\s]+", (raw or "").strip()) if t]


@router.post("/pairs", response_model=Task23Job)
async def create(body: CreateBody) -> Task23Job:
    tickers = _parse(body.tickers)
    if len(tickers) != 2:
        raise HTTPException(400, "provide exactly 2 tickers (e.g. 'KO, PEP')")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task23Job(job_id=job_id, tickers=tickers, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/pairs", response_model=list[Task23Job])
async def list_jobs() -> list[Task23Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/pairs/{job_id}", response_model=Task23Job)
async def get_job(job_id: str) -> Task23Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "pairs job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task23-pairs"}


async def _run(job: Task23Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_pairs_pipeline(ticker_a=job.tickers[0], ticker_b=job.tickers[1], job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task23_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
