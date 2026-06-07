"""Task 21 API — cross-sectional ranking agent. Same in-memory job pattern as Task 10."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus
from task21_ranker.pipeline.orchestrator import NotEnoughNames, new_job_id, run_rank_pipeline
from task21_ranker.schemas import Task21Job

logger = get_logger(__name__)
router = APIRouter(prefix="/task21", tags=["task21"])

_JOBS: dict[str, Task21Job] = {}
# Up to ~20 names + SPY fetched concurrently, one LLM author, one backtest.
_JOB_TIMEOUT_S = 200.0


class CreateRankBody(BaseModel):
    tickers: str   # comma/space-separated watchlist, e.g. "AAPL, MSFT, NVDA, AMZN, GOOGL"


def _parse(raw: str) -> list[str]:
    return [t.upper() for t in re.split(r"[,\s]+", (raw or "").strip()) if t]


@router.post("/rankings", response_model=Task21Job)
async def create_ranking(body: CreateRankBody) -> Task21Job:
    tickers = _parse(body.tickers)
    if len(tickers) < 3:
        raise HTTPException(400, "provide at least 3 tickers (e.g. 'AAPL, MSFT, NVDA, AMZN, META')")
    if len(tickers) > 20:
        raise HTTPException(400, "at most 20 tickers per ranking")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task21Job(job_id=job_id, tickers=tickers, status=JobStatus.PENDING, created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/rankings", response_model=list[Task21Job])
async def list_rankings() -> list[Task21Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/rankings/{job_id}", response_model=Task21Job)
async def get_ranking(job_id: str) -> Task21Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "ranking job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task21-ranker"}


async def _run(job: Task21Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_rank_pipeline(tickers=job.tickers, job_id=job.job_id), timeout=_JOB_TIMEOUT_S
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = f"Timed out after {int(_JOB_TIMEOUT_S)}s — retry with fewer tickers."
    except NotEnoughNames as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task21_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
