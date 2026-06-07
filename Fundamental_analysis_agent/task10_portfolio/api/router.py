"""Task 10 API — portfolio / risk-sizing agent. Same in-memory job pattern as the others."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared.logging import get_logger
from shared.schemas import JobStatus

from task10_portfolio.pipeline.orchestrator import (
    NotEnoughNames,
    new_job_id,
    run_portfolio_pipeline,
)
from task10_portfolio.schemas import Task10Job

logger = get_logger(__name__)

router = APIRouter(prefix="/task10", tags=["task10"])

_JOBS: dict[str, Task10Job] = {}
# Up to ~15 names, each runs a T4 author + backtest + price fetches → give it room.
_JOB_TIMEOUT_S = 260.0


class CreatePortfolioBody(BaseModel):
    tickers: str   # comma/space-separated watchlist, e.g. "AAPL, MSFT, NVDA"


def _parse(raw: str) -> list[str]:
    return [t.upper() for t in re.split(r"[,\s]+", (raw or "").strip()) if t]


@router.post("/portfolios", response_model=Task10Job)
async def create_portfolio(body: CreatePortfolioBody) -> Task10Job:
    tickers = _parse(body.tickers)
    if len(tickers) < 2:
        raise HTTPException(400, "provide at least 2 tickers (e.g. 'AAPL, MSFT, NVDA')")
    if len(tickers) > 15:
        raise HTTPException(400, "at most 15 tickers per portfolio")
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task10Job(job_id=job_id, tickers=tickers, status=JobStatus.PENDING,
                    created_at=now, updated_at=now)
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/portfolios", response_model=list[Task10Job])
async def list_portfolios() -> list[Task10Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/portfolios/{job_id}", response_model=Task10Job)
async def get_portfolio(job_id: str) -> Task10Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "portfolio job not found")
    return job


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "task": "task10-portfolio"}


async def _run(job: Task10Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        job.result = await asyncio.wait_for(
            run_portfolio_pipeline(tickers=job.tickers, job_id=job.job_id),
            timeout=_JOB_TIMEOUT_S,
        )
        job.status = JobStatus.SUCCEEDED
    except asyncio.TimeoutError:
        job.status = JobStatus.FAILED
        job.error_message = (
            f"Timed out after {int(_JOB_TIMEOUT_S)}s (per-name signals + sizing + portfolio "
            f"backtest). Try fewer tickers or retry — the backend may be throttling."
        )
    except NotEnoughNames as e:
        job.status = JobStatus.FAILED
        job.error_message = str(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("task10_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
