"""
Background task for Google Sheets lead sync.
"""
import logging
import asyncio

logger = logging.getLogger(__name__)


async def run_google_sheets_sync():
    """
    Async task to sync leads from Google Sheets.
    Called by the scheduler every minute.
    """
    try:
        from app.services.google_sheets_sync import sync_google_sheet_leads
        await sync_google_sheet_leads()
    except Exception as e:
        logger.error(f"Google Sheets sync task failed: {e}")


def run_google_sheets_sync_task():
    """
    Wrapper to run the async sync function. Scheduler runs this in a thread pool,
    so we must schedule the coroutine on the main event loop in a thread-safe way.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # We're in a scheduler thread; schedule coroutine on the main loop and wait so job doesn't overlap
            future = asyncio.run_coroutine_threadsafe(run_google_sheets_sync(), loop)
            future.result(timeout=120)  # wait up to 2 min so max_instances=1 is respected
        else:
            loop.run_until_complete(run_google_sheets_sync())
    except RuntimeError:
        asyncio.run(run_google_sheets_sync())
