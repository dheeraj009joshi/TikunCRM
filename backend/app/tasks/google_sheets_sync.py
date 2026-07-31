"""
Background task for Google Sheets lead sync.

Supports both:
1. Dynamic sync sources from database (LeadSyncSource model)
2. Legacy hardcoded sync (fallback when no sources configured)

Each LeadSyncSource has its own sync_interval_minutes setting.
The task runs frequently but only syncs sources whose interval has elapsed.
"""
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


def _aware_utc(dt: datetime) -> datetime:
    """Normalize DB timestamps so interval math never mixes naive/aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def run_google_sheets_sync():
    """
    Async task to sync leads from Google Sheets.
    Called by the scheduler frequently (e.g., every 2 minutes).

    This function:
    1. Gets all active LeadSyncSource records
    2. For each source, checks if sync_interval_minutes has elapsed since last_synced_at
    3. Only syncs sources that are due for sync
    4. Falls back to legacy hardcoded sync if no sources are configured
    """
    try:
        logger.info("=== GOOGLE SHEETS SYNC TASK STARTED ===")

        from sqlalchemy import select
        from app.services.google_sheets_sync import (
            get_sync_session_maker,
            sync_leads_from_source,
            _legacy_sync_google_sheet_leads,
        )
        from app.models.lead_sync_source import LeadSyncSource
        from app.core.timezone import utc_now

        sync_session_maker = get_sync_session_maker()

        async with sync_session_maker() as session:
            result = await session.execute(
                select(LeadSyncSource).where(LeadSyncSource.is_active == True)
            )
            sources = list(result.scalars().all())

        if not sources:
            logger.info("No active sync sources configured - using legacy sync")
            return await _legacy_sync_google_sheet_leads()

        logger.info(f"Found {len(sources)} active sync sources")

        now = utc_now()
        total_stats = {
            "sheet_total_rows": 0,
            "sheet_valid_leads": 0,
            "new_added": 0,
            "leads_updated": 0,
            "duplicates_skipped": 0,
            "skipped_invalid": 0,
            "sources_synced": 0,
            "sources_skipped": 0,
            "errors": [],
        }

        for source in sources:
            # Check if this source is due for sync
            if source.last_synced_at:
                last = _aware_utc(source.last_synced_at)
                time_since_last_sync = now - last
                interval = timedelta(minutes=max(1, source.sync_interval_minutes or 5))

                if time_since_last_sync < interval:
                    remaining = interval - time_since_last_sync
                    logger.debug(
                        f"Skipping {source.name}: synced {time_since_last_sync.total_seconds():.0f}s ago, "
                        f"next sync in {remaining.total_seconds():.0f}s"
                    )
                    total_stats["sources_skipped"] += 1
                    continue

            # Source is due for sync
            logger.info(f"Syncing source: {source.name}")

            try:
                stats = await sync_leads_from_source(source)
                total_stats["sheet_total_rows"] += stats.get("sheet_total_rows", 0)
                total_stats["sheet_valid_leads"] += stats.get("sheet_valid_leads", 0)
                total_stats["new_added"] += stats.get("new_added", 0)
                total_stats["leads_updated"] += stats.get("leads_updated", 0)
                total_stats["duplicates_skipped"] += stats.get("duplicates_skipped", 0)
                total_stats["skipped_invalid"] += stats.get("skipped_invalid", 0)
                total_stats["sources_synced"] += 1

                if stats.get("error"):
                    total_stats["errors"].append(f"{source.name}: {stats['error']}")
                    logger.error(f"Sync source {source.name} returned error: {stats['error']}")

            except Exception as e:
                logger.error(f"Failed to sync source {source.name}: {e}")
                total_stats["errors"].append(f"{source.name}: {str(e)}")

        sources_synced = total_stats["sources_synced"]
        sources_skipped = total_stats["sources_skipped"]
        new_leads = total_stats["new_added"]
        updated = total_stats["leads_updated"]
        errors = total_stats["errors"]

        logger.info(
            f"=== SYNC COMPLETE: {sources_synced} sources synced, {sources_skipped} skipped, "
            f"{new_leads} new leads, {updated} updated"
            + (f", errors={len(errors)}" if errors else "")
            + " ==="
        )

        return total_stats

    except Exception as e:
        logger.exception(f"Google Sheets sync task failed: {e}")
        return {"error": str(e)}


def run_google_sheets_sync_task():
    """
    Sync wrapper kept for backwards compatibility / scripts.
    Prefer scheduling the async `run_google_sheets_sync` directly on AsyncIOScheduler.
    """
    import asyncio

    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            future = asyncio.run_coroutine_threadsafe(run_google_sheets_sync(), loop)
            return future.result(timeout=300)
        return asyncio.run(run_google_sheets_sync())
    except Exception as e:
        logger.exception(f"Google Sheets sync task wrapper failed: {e}")
        return {"error": str(e)}
