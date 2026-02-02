"""
Background task scheduler using APScheduler

Handles periodic background tasks including:
- IMAP email sync for all users (every 1 minute)
- Google Sheets lead sync (every 1 minute)
"""
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler: AsyncIOScheduler = None


def get_scheduler() -> AsyncIOScheduler:
    """Get the scheduler instance."""
    global scheduler
    if scheduler is None:
        scheduler = AsyncIOScheduler()
    return scheduler


def setup_scheduler():
    """
    Set up background task scheduler with all jobs.
    Called during application startup.
    """
    scheduler = get_scheduler()
    
    # IMAP email sync - runs every 1 minute to fetch incoming emails
    # Each user has their own Hostinger email credentials configured
    from app.tasks.email_sync import run_email_sync
    scheduler.add_job(
        run_email_sync,
        trigger=IntervalTrigger(minutes=1),
        id="email_sync",
        name="Sync incoming emails from IMAP for all users",
        replace_existing=True,
        max_instances=1,  # Prevent overlapping runs
    )
    
    # Google Sheets lead sync - runs every 1 minute to fetch new leads
    from app.tasks.google_sheets_sync import run_google_sheets_sync_task
    scheduler.add_job(
        run_google_sheets_sync_task,
        trigger=IntervalTrigger(minutes=1),
        id="google_sheets_sync",
        name="Sync leads from Google Sheets",
        replace_existing=True,
        max_instances=1,  # Prevent overlapping runs
    )
    
    logger.info("Background scheduler configured:")
    logger.info("  - IMAP email sync (every 1 minute)")
    logger.info("  - Google Sheets lead sync (every 1 minute)")


def start_scheduler():
    """Start the scheduler."""
    scheduler = get_scheduler()
    if not scheduler.running:
        scheduler.start()
        logger.info("Background scheduler started")


def stop_scheduler():
    """Stop the scheduler gracefully."""
    global scheduler
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=True)
        logger.info("Background scheduler stopped")


@asynccontextmanager
async def scheduler_lifespan():
    """
    Async context manager for scheduler lifecycle.
    Use with FastAPI lifespan.
    """
    setup_scheduler()
    start_scheduler()
    yield
    stop_scheduler()
