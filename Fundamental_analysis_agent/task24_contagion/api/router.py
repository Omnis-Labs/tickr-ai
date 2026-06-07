"""Task 24 API — earnings-contagion agent. Input is (bellwether, peer)."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task24_contagion.pipeline.orchestrator import TickerNotFound, new_job_id, run_contagion_pipeline
from task24_contagion.schemas import Task24Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task24", tags=["task24"])
_JOBS: dict[str, Task24Job] = {}
_JOB_TIMEOUT_S = 150.0


class CreateBody(BaseModel):
    tickers: str   # "BELLWETHER, PEER" — first reports, second is traded


def _parse(raw: str) -> list[str]:
    return [t.upper() for t in re.split(r"[,\s]+", (raw or "").strip()) if t]


@router.post("/contagion", response_model=Task24Job)
async def create(body: CreateBody) -> Task24Job:
    tickers = _parse(body.tickers)
    if len(tickers) != 2:
        raise HTTPException(400, "provide exactly 2 tickers as 'BELLWETHER, PEER' (e.g. 'AVGO, MRVL')")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task24Job(job_id=job_id, tickers=tickers, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/contagion", response_model=list[Task24Job])
async def list_jobs() -> list[Task24Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/contagion/{job_id}", response_model=Task24Job)
async def get_job(job_id: str) -> Task24Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "contagion job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task24-contagion"}


async def _run(job: Task24Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_contagion_pipeline(bellwether=job.tickers[0], peer=job.tickers[1], job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S)
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry."
    except TickerNotFound as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task24_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
