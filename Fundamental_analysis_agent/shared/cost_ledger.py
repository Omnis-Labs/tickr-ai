"""Cost ledger — single source of truth for every dollar spent on LLM calls.

Design rule: every LLM call writes one row here BEFORE the response is returned
to the caller. Analysis reports query this table directly — no estimation.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from shared.config import get_settings
from shared.schemas import CostRecord


class Base(DeclarativeBase):
    pass


class CostRow(Base):
    __tablename__ = "cost_ledger"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trace_id = Column(String(64), index=True, nullable=False)
    purpose = Column(String(128), index=True, nullable=False)
    model = Column(String(64), nullable=False)
    backend = Column(String(16), nullable=False)
    input_tokens = Column(Integer, nullable=False)
    output_tokens = Column(Integer, nullable=False)
    cache_read_tokens = Column(Integer, nullable=False, default=0)
    cache_write_tokens = Column(Integer, nullable=False, default=0)
    cost_usd = Column(Float, nullable=False)
    latency_ms = Column(Integer, nullable=False)
    cache_hit = Column(Boolean, nullable=False, default=False)
    # `timezone=True` → Postgres TIMESTAMPTZ. Without it the column type is
    # TIMESTAMP WITHOUT TIME ZONE and asyncpg refuses our tz-aware
    # datetime.now(timezone.utc) values with "can't subtract offset-naive
    # and offset-aware datetimes". Saw this on first cost_ledger INSERT
    # against Supabase Postgres.
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)


class SelectorHistoryRow(Base):
    """Tracks which locators have worked for each (site, target_description)
    pair so that future runs can prefer known-good selectors.

    Designed in PLAN.md §2.3 as the basis for selector-drift detection:
    persistent record of (success_count, failure_count) per primary selector
    lets us spot rising failure rates per site and trigger a "needs review"
    alert before the agent's first-try success rate degrades.
    """

    __tablename__ = "selector_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_host = Column(String(255), index=True, nullable=False)
    target_signature = Column(String(255), index=True, nullable=False)
    primary_selector = Column(String(1024), nullable=False)
    semantic_role = Column(String(64), nullable=True)
    semantic_name = Column(String(255), nullable=True)
    success_count = Column(Integer, nullable=False, default=1)
    failure_count = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=False, index=True)


_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _ensure_sqlite_dir(url: str) -> None:
    if url.startswith("sqlite"):
        path = url.split(":///", 1)[-1]
        Path(path).parent.mkdir(parents=True, exist_ok=True)


async def init_db() -> None:
    global _engine, _sessionmaker
    settings = get_settings()
    _ensure_sqlite_dir(settings.database_url)
    _engine = create_async_engine(settings.database_url, echo=False, future=True)
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    if _sessionmaker is None:
        await init_db()
    assert _sessionmaker is not None
    async with _sessionmaker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def record_cost(record: CostRecord) -> None:
    async with session_scope() as session:
        session.add(
            CostRow(
                trace_id=record.trace_id,
                purpose=record.purpose,
                model=record.model,
                backend=record.backend,
                input_tokens=record.input_tokens,
                output_tokens=record.output_tokens,
                cache_read_tokens=record.cache_read_tokens,
                cache_write_tokens=record.cache_write_tokens,
                cost_usd=record.cost_usd,
                latency_ms=record.latency_ms,
                cache_hit=record.cache_hit,
                occurred_at=record.occurred_at,
            )
        )


async def cost_for_trace(trace_id: str) -> float:
    from sqlalchemy import func, select

    async with session_scope() as session:
        result = await session.execute(
            select(func.coalesce(func.sum(CostRow.cost_usd), 0.0)).where(
                CostRow.trace_id == trace_id
            )
        )
        return float(result.scalar_one())


async def cost_since(since: datetime) -> float:
    from sqlalchemy import func, select

    async with session_scope() as session:
        result = await session.execute(
            select(func.coalesce(func.sum(CostRow.cost_usd), 0.0)).where(
                CostRow.occurred_at >= since
            )
        )
        return float(result.scalar_one())


async def record_selector_success(
    *,
    site_host: str,
    target_signature: str,
    primary_selector: str | None,
    semantic_role: str | None,
    semantic_name: str | None,
) -> None:
    """Bump success_count if the (site, signature, selector) exists; insert otherwise.

    `target_signature` is a normalized form of the NL target_description so
    "the search input" and "Search input" match the same row.
    """
    if not primary_selector and not semantic_role:
        return  # nothing identifying to record
    from sqlalchemy import select, update

    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        stmt = select(SelectorHistoryRow).where(
            SelectorHistoryRow.site_host == site_host,
            SelectorHistoryRow.target_signature == target_signature,
            SelectorHistoryRow.primary_selector == (primary_selector or ""),
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing:
            await session.execute(
                update(SelectorHistoryRow)
                .where(SelectorHistoryRow.id == existing.id)
                .values(
                    success_count=SelectorHistoryRow.success_count + 1,
                    last_used_at=now,
                )
            )
        else:
            session.add(
                SelectorHistoryRow(
                    site_host=site_host,
                    target_signature=target_signature,
                    primary_selector=primary_selector or "",
                    semantic_role=semantic_role,
                    semantic_name=semantic_name,
                    success_count=1,
                    failure_count=0,
                    last_used_at=now,
                )
            )


async def record_selector_failure(
    *,
    site_host: str,
    target_signature: str,
    primary_selector: str | None,
) -> None:
    from sqlalchemy import select, update

    if not primary_selector:
        return
    async with session_scope() as session:
        stmt = select(SelectorHistoryRow).where(
            SelectorHistoryRow.site_host == site_host,
            SelectorHistoryRow.target_signature == target_signature,
            SelectorHistoryRow.primary_selector == primary_selector,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing:
            await session.execute(
                update(SelectorHistoryRow)
                .where(SelectorHistoryRow.id == existing.id)
                .values(failure_count=SelectorHistoryRow.failure_count + 1)
            )


async def get_known_good_selectors(
    *, site_host: str, target_signature: str, limit: int = 3
) -> list[dict]:
    """Return up to N (selector, success_count, failure_count) for this
    (site, target) pair, ranked by success_count - failure_count.
    """
    from sqlalchemy import select

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(SelectorHistoryRow)
                .where(
                    SelectorHistoryRow.site_host == site_host,
                    SelectorHistoryRow.target_signature == target_signature,
                )
                .order_by(
                    (SelectorHistoryRow.success_count - SelectorHistoryRow.failure_count).desc()
                )
                .limit(limit)
            )
        ).scalars().all()
    return [
        {
            "primary": r.primary_selector,
            "semantic_role": r.semantic_role,
            "semantic_name": r.semantic_name,
            "success_count": r.success_count,
            "failure_count": r.failure_count,
        }
        for r in rows
    ]


async def cost_summary() -> dict:
    """Aggregated view of all-time spend for the dashboard.

    Returns total cost, total call count, plus per-purpose / per-model /
    per-backend breakdowns. Cheap query on the indexed `purpose` column,
    fine to call on every dashboard render.
    """
    from sqlalchemy import desc, func, select

    async with session_scope() as session:
        total = (
            await session.execute(
                select(
                    func.coalesce(func.sum(CostRow.cost_usd), 0.0),
                    func.count(CostRow.id),
                    func.coalesce(func.sum(CostRow.input_tokens), 0),
                    func.coalesce(func.sum(CostRow.output_tokens), 0),
                )
            )
        ).one()
        total_cost, total_calls, total_in, total_out = total

        by_purpose_rows = (
            await session.execute(
                select(
                    CostRow.purpose,
                    func.count(CostRow.id),
                    func.coalesce(func.sum(CostRow.cost_usd), 0.0),
                    func.coalesce(func.sum(CostRow.input_tokens), 0),
                    func.coalesce(func.sum(CostRow.output_tokens), 0),
                )
                .group_by(CostRow.purpose)
                .order_by(desc(func.sum(CostRow.cost_usd)))
            )
        ).all()

        by_model_rows = (
            await session.execute(
                select(
                    CostRow.model,
                    CostRow.backend,
                    func.count(CostRow.id),
                    func.coalesce(func.sum(CostRow.cost_usd), 0.0),
                )
                .group_by(CostRow.model, CostRow.backend)
                .order_by(desc(func.sum(CostRow.cost_usd)))
            )
        ).all()

        cache_hits = (
            await session.execute(
                select(func.count()).where(CostRow.cache_hit.is_(True))
            )
        ).scalar_one()

    return {
        "total_cost_usd": float(total_cost),
        "total_calls": int(total_calls),
        "total_input_tokens": int(total_in),
        "total_output_tokens": int(total_out),
        "cache_hit_count": int(cache_hits),
        "cache_hit_rate": (cache_hits / total_calls) if total_calls else 0.0,
        "by_purpose": [
            {
                "purpose": row[0],
                "calls": int(row[1]),
                "cost_usd": float(row[2]),
                "input_tokens": int(row[3]),
                "output_tokens": int(row[4]),
            }
            for row in by_purpose_rows
        ],
        "by_model": [
            {
                "model": row[0],
                "backend": row[1],
                "calls": int(row[2]),
                "cost_usd": float(row[3]),
            }
            for row in by_model_rows
        ],
    }
