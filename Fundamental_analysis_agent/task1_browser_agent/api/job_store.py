"""In-memory job store for Task 1. Per-process; fine for single-worker MVP.

For multi-worker prod we'd swap this for Postgres or Redis. Interface is
deliberately small so the swap is a one-file change.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from shared.schemas import JobStatus, Task1Job, Task1StepEvent


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Task1Job] = {}
        self._queues: dict[str, asyncio.Queue[Task1StepEvent | None]] = {}
        self._lock = asyncio.Lock()

    async def create(self, *, task_description: str) -> Task1Job:
        async with self._lock:
            job_id = uuid.uuid4().hex[:16]
            now = datetime.now(timezone.utc)
            job = Task1Job(
                job_id=job_id,
                task_description=task_description,
                status=JobStatus.PENDING,
                created_at=now,
                updated_at=now,
            )
            self._jobs[job_id] = job
            self._queues[job_id] = asyncio.Queue(maxsize=256)
            return job

    def get(self, job_id: str) -> Task1Job | None:
        return self._jobs.get(job_id)

    def list_recent(self, limit: int = 20) -> list[Task1Job]:
        return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)[:limit]

    async def push_event(self, job_id: str, event: Task1StepEvent) -> None:
        q = self._queues.get(job_id)
        if q is None:
            return
        await q.put(event)

    async def close(self, job_id: str) -> None:
        q = self._queues.get(job_id)
        if q is None:
            return
        await q.put(None)  # sentinel

    async def stream(self, job_id: str) -> AsyncIterator[Task1StepEvent]:
        q = self._queues.get(job_id)
        if q is None:
            return
        while True:
            ev = await q.get()
            if ev is None:
                return
            yield ev


store = JobStore()
