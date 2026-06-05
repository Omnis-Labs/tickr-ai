"""Artifact store — DOM snapshots, screenshots, raw HTML.

`ARTIFACT_BACKEND=local` writes to `ARTIFACT_DIR`. `ARTIFACT_BACKEND=supabase`
uploads to a Supabase Storage bucket via the REST API. Both return an
`ArtifactRef` the caller persists in a job row.

Switching backends is a single env-var change; no code path changes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

import httpx

from shared.config import get_settings
from shared.logging import get_logger
from shared.schemas import ArtifactRef

logger = get_logger(__name__)


class _Backend(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> ArtifactRef: ...
    async def get(self, key: str) -> bytes: ...


class _LocalBackend:
    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    async def put(self, key: str, data: bytes, content_type: str) -> ArtifactRef:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return ArtifactRef(
            key=key,
            content_type=content_type,
            size_bytes=len(data),
            created_at=datetime.now(timezone.utc),
        )

    async def get(self, key: str) -> bytes:
        return (self.root / key).read_bytes()


class _SupabaseBackend:
    """Supabase Storage backend (REST API).

    Auth: service-role key in the `Authorization` and `apikey` headers.
    Storage REST docs: https://supabase.com/docs/reference/api/storage-api
    """

    def __init__(self, *, supabase_url: str, service_key: str, bucket: str) -> None:
        if not supabase_url or not service_key or not bucket:
            raise RuntimeError(
                "Supabase artifact backend requires SUPABASE_URL, "
                "SUPABASE_SERVICE_KEY, and SUPABASE_STORAGE_BUCKET."
            )
        self.base = supabase_url.rstrip("/")
        self.bucket = bucket
        self.headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }

    async def put(self, key: str, data: bytes, content_type: str) -> ArtifactRef:
        url = f"{self.base}/storage/v1/object/{self.bucket}/{key}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            # `upsert=true` so re-running an eval case overwrites prior artifacts.
            resp = await client.post(
                url,
                content=data,
                headers={
                    **self.headers,
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"Supabase upload {resp.status_code} for {key}: {resp.text[:200]}"
                )
        return ArtifactRef(
            key=key,
            content_type=content_type,
            size_bytes=len(data),
            created_at=datetime.now(timezone.utc),
        )

    async def get(self, key: str) -> bytes:
        url = f"{self.base}/storage/v1/object/{self.bucket}/{key}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers=self.headers)
            if resp.status_code == 404:
                raise FileNotFoundError(key)
            resp.raise_for_status()
            return resp.content


_backend: _Backend | None = None


def _get_backend() -> _Backend:
    global _backend
    if _backend is None:
        settings = get_settings()
        if settings.artifact_backend == "supabase":
            _backend = _SupabaseBackend(
                supabase_url=settings.supabase_url,
                service_key=settings.supabase_service_key,
                bucket=settings.supabase_storage_bucket,
            )
            logger.info("artifact_backend_chosen", backend="supabase", bucket=settings.supabase_storage_bucket)
        else:
            _backend = _LocalBackend(settings.artifact_dir)
    return _backend


async def put_artifact(
    key: str, data: bytes, content_type: str = "application/octet-stream"
) -> ArtifactRef:
    return await _get_backend().put(key, data, content_type)


async def get_artifact(key: str) -> bytes:
    return await _get_backend().get(key)
