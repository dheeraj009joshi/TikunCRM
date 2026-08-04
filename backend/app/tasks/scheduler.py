"""
Background task scheduler using APScheduler

Active jobs only:
- Google Sheets lead sync (every 2 minutes)
- Lead auto-assignment on first note (every 2 minutes)
- Stale lead unassignment (every hour)
- Appointment reminders (every 5 minutes)
- Follow-up reminders (every 15 minutes)
- Missed appointment detection (every 30 minutes)

IMAP email sync and WhatsApp bulk/auto workers are intentionally not scheduled.
"""
import logging
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler: AsyncIOScheduler = None


def get_scheduler() -> AsyncIOScheduler:
    """Get the scheduler instance."""
    global scheduler
    if scheduler is None:
        scheduler = AsyncIOScheduler(
            job_defaults={
                'coalesce': True,
                'max_instances': 1,
                'misfire_grace_time': 30,
            }
        )
    return scheduler


def setup_scheduler():
    """
    Set up background task scheduler with lead sync + appointment jobs only.
    Called during application startup.
    """
    scheduler = get_scheduler()

    # Remove jobs we no longer want (survives replace_existing if ids change across deploys)
    for obsolete_id in ("email_sync", "whatsapp_bulk_sends", "auto_whatsapp_worker"):
        if scheduler.get_job(obsolete_id):
            scheduler.remove_job(obsolete_id)
            logger.info("Removed obsolete scheduler job: %s", obsolete_id)

    # Google Sheets lead sync - every 2 minutes.
    # Per-source sync_interval_minutes still gates which sheets are actually pulled.
    from app.tasks.google_sheets_sync import run_google_sheets_sync
    scheduler.add_job(
        run_google_sheets_sync,
        trigger=IntervalTrigger(minutes=2, start_date=datetime.now() + timedelta(seconds=20)),
        id="google_sheets_sync",
        name="Sync leads from Google Sheets",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=120,
    )

    # Lead auto-assignment - every 2 minutes
    from app.tasks.lead_assignment import run_auto_assign_task
    scheduler.add_job(
        run_auto_assign_task,
        trigger=IntervalTrigger(minutes=2, start_date=datetime.now() + timedelta(seconds=50)),
        id="lead_auto_assign",
        name="Auto-assign leads based on first note",
        replace_existing=True,
    )

    # Stale lead unassignment - every hour
    from app.tasks.lead_assignment import run_stale_unassign_task
    scheduler.add_job(
        run_stale_unassign_task,
        trigger=IntervalTrigger(hours=1),
        id="lead_stale_unassign",
        name="Unassign leads with no activity for 3 days (dealership kept)",
        replace_existing=True,
        max_instances=1,
    )

    # Appointment reminders - every 5 minutes
    from app.tasks.reminder_tasks import send_appointment_reminders
    scheduler.add_job(
        send_appointment_reminders,
        trigger=IntervalTrigger(minutes=5),
        id="appointment_reminders",
        name="Send appointment reminders (1 hour before)",
        replace_existing=True,
        max_instances=1,
    )

    # Follow-up reminders - every 15 minutes
    from app.tasks.reminder_tasks import send_followup_reminders
    scheduler.add_job(
        send_followup_reminders,
        trigger=IntervalTrigger(minutes=15),
        id="followup_reminders",
        name="Send follow-up reminders (1 hour before)",
        replace_existing=True,
        max_instances=1,
    )

    # Missed appointment detection - every 30 minutes
    from app.tasks.reminder_tasks import detect_missed_appointments
    scheduler.add_job(
        detect_missed_appointments,
        trigger=IntervalTrigger(minutes=30),
        id="missed_appointments",
        name="Detect and process missed appointments",
        replace_existing=True,
        max_instances=1,
    )

    logger.info("Background scheduler configured (lead sync + appointments only):")
    logger.info("  - Google Sheets lead sync (every 2 minutes)")
    logger.info("  - Lead auto-assignment (every 2 minutes)")
    logger.info("  - Stale lead unassignment (every hour)")
    logger.info("  - Appointment reminders (every 5 minutes)")
    logger.info("  - Follow-up reminders (every 15 minutes)")
    logger.info("  - Missed appointment detection (every 30 minutes)")
    logger.info("  - DISABLED: IMAP email sync, WhatsApp bulk, Auto WhatsApp worker")


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
