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
    Wrapper to run the async sync function.
    APScheduler needs a regular function, so we create an event loop.
    """
    try:
        # Try to get existing event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If loop is already running (FastAPI), create a task
            asyncio.create_task(run_google_sheets_sync())
        else:
            loop.run_until_complete(run_google_sheets_sync())
    except RuntimeError:
        # No event loop exists, create a new one
        asyncio.run(run_google_sheets_sync())
