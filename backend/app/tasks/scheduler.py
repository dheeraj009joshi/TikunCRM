"""
Background task scheduler using APScheduler

Handles periodic background tasks including:
- IMAP email sync for all users (every 2 minutes)
- Google Sheets lead sync (every 2 minutes, staggered)
- Lead auto-assignment on first note (every 2 minutes, staggered)
- Stale lead unassignment after 72 hours (every hour)

Tasks are staggered to prevent overwhelming the database connection pool.
"""
import logging
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler: AsyncIOScheduler = None


def get_scheduler() -> AsyncIOScheduler:
    """Get the scheduler instance."""
    global scheduler
    if scheduler is None:
        # Use a thread pool executor with limited workers to prevent blocking
        scheduler = AsyncIOScheduler(
            job_defaults={
                'coalesce': True,  # Combine multiple missed runs into one
                'max_instances': 1,  # Only one instance of each job at a time
                'misfire_grace_time': 30,  # Allow 30s grace period for missed jobs
            }
        )
    return scheduler


def setup_scheduler():
    """
    Set up background task scheduler with all jobs.
    Called during application startup.
    
    Tasks are staggered to prevent all tasks from running simultaneously
    and overwhelming the database connection pool.
    """
    scheduler = get_scheduler()
    
    # IMAP email sync - runs at :00 and :30 of each minute (every 2 minutes)
    from app.tasks.email_sync import run_email_sync
    scheduler.add_job(
        run_email_sync,
        trigger=IntervalTrigger(minutes=2),
        id="email_sync",
        name="Sync incoming emails from IMAP for all users",
        replace_existing=True,
    )
    
    # Google Sheets lead sync - runs every 2 minutes, starting 40 seconds after email sync
    from app.tasks.google_sheets_sync import run_google_sheets_sync_task
    scheduler.add_job(
        run_google_sheets_sync_task,
        trigger=IntervalTrigger(minutes=2, start_date=datetime.now() + timedelta(seconds=40)),
        id="google_sheets_sync",
        name="Sync leads from Google Sheets",
        replace_existing=True,
    )
    
    # Lead auto-assignment - runs every 2 minutes, starting 80 seconds after email sync
    from app.tasks.lead_assignment import run_auto_assign_task
    scheduler.add_job(
        run_auto_assign_task,
        trigger=IntervalTrigger(minutes=2, start_date=datetime.now() + timedelta(seconds=80)),
        id="lead_auto_assign",
        name="Auto-assign leads based on first note",
        replace_existing=True,
    )
    
    # Stale lead unassignment - runs every hour to unassign inactive leads
    from app.tasks.lead_assignment import run_stale_unassign_task
    scheduler.add_job(
        run_stale_unassign_task,
        trigger=IntervalTrigger(hours=1),
        id="lead_stale_unassign",
        name="Unassign leads with no activity for 72 hours",
        replace_existing=True,
        max_instances=1,
    )
    
    # Appointment reminders - runs every 5 minutes to send 1-hour advance reminders
    from app.tasks.reminder_tasks import send_appointment_reminders
    scheduler.add_job(
        send_appointment_reminders,
        trigger=IntervalTrigger(minutes=5),
        id="appointment_reminders",
        name="Send appointment reminders (1 hour before)",
        replace_existing=True,
        max_instances=1,
    )
    
    # Follow-up reminders - runs every 15 minutes to send 1-hour advance reminders
    from app.tasks.reminder_tasks import send_followup_reminders
    scheduler.add_job(
        send_followup_reminders,
        trigger=IntervalTrigger(minutes=15),
        id="followup_reminders",
        name="Send follow-up reminders (1 hour before)",
        replace_existing=True,
        max_instances=1,
    )
    
    # Missed appointment detection - runs every 30 minutes
    from app.tasks.reminder_tasks import detect_missed_appointments
    scheduler.add_job(
        detect_missed_appointments,
        trigger=IntervalTrigger(minutes=30),
        id="missed_appointments",
        name="Detect and process missed appointments",
        replace_existing=True,
        max_instances=1,
    )
    
    logger.info("Background scheduler configured (tasks staggered to prevent blocking):")
    logger.info("  - IMAP email sync (every 2 minutes, offset: 0s)")
    logger.info("  - Google Sheets lead sync (every 2 minutes, offset: 40s)")
    logger.info("  - Lead auto-assignment (every 2 minutes, offset: 80s)")
    logger.info("  - Stale lead unassignment (every hour)")
    logger.info("  - Appointment reminders (every 5 minutes)")
    logger.info("  - Follow-up reminders (every 15 minutes)")
    logger.info("  - Missed appointment detection (every 30 minutes)")


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
