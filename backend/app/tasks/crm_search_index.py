"""
Background indexing of CRM activities into Azure AI Search.
"""
from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from app.db.database import async_session_maker, get_background_session_maker
from app.services.crm_content_search_service import (
    CrmContentSearchService,
    is_indexable_activity,
)
from app.models.activity import Activity

logger = logging.getLogger(__name__)

_inflight: set[str] = set()


def queue_activity_index(activity_id: UUID) -> None:
    """Schedule indexing after DB commit (fire-and-forget)."""
    aid = str(activity_id)
    if aid in _inflight:
        return
    _inflight.add(aid)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_index_activity_task(activity_id))
    except RuntimeError:
        _inflight.discard(aid)
        logger.debug("No event loop for CRM index task")


async def _index_activity_task(activity_id: UUID) -> None:
    aid = str(activity_id)
    try:
        async with async_session_maker() as db:
            from sqlalchemy import select

            result = await db.execute(
                select(Activity.type).where(Activity.id == activity_id)
            )
            row = result.first()
            if not row or not is_indexable_activity(row[0]):
                return
            await CrmContentSearchService.index_activity(db, activity_id)
    except Exception:
        logger.exception("CRM index task failed for activity %s", activity_id)
    finally:
        _inflight.discard(aid)


async def run_crm_search_backfill() -> None:
    """Scheduled job: ensure index exists and backfill recent history."""
    if not CrmContentSearchService.is_azure_configured():
        return
    logger.info("Starting CRM search backfill job")
    session_maker = get_background_session_maker()
    async with session_maker() as db:
        stats = await CrmContentSearchService.backfill_index(db, batch_size=150, max_batches=20)
        await db.commit()
    logger.info("CRM search backfill complete: %s", stats)
