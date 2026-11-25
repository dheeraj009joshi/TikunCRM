"""
Background task scheduler using APScheduler

Active jobs only:
- Google Sheets lead sync (every 2 minutes)
- Lead auto-assignment on first note (every 2 minutes)
- Stale lead unassignment (every hour)
- Appointment reminders (every 5 minutes)
- Follow-up reminders (every 15 minutes)
- Missed appointment detection (every 30 minutes)
- Partner lead routing retry (every 2 minutes)

IMAP email sync and WhatsApp bulk/auto workers are intentionally not scheduled.
"""
import logging
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
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

    # CRM Azure Search backfill — daily when Azure AI Search is configured
    from app.tasks.crm_search_index import run_crm_search_backfill
    scheduler.add_job(
        run_crm_search_backfill,
        trigger=IntervalTrigger(hours=24, start_date=datetime.now() + timedelta(hours=1)),
        id="crm_search_backfill",
        name="Backfill CRM content into Azure AI Search",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )

    # AI call reviews - every 5 minutes: review new recorded calls, retry failures.
    # The job itself is a no-op unless CALL_REVIEW_AUTO_ENABLED is on.
    from app.services.call_review_service import run_call_review_sweep
    scheduler.add_job(
        run_call_review_sweep,
        trigger=IntervalTrigger(minutes=5, start_date=datetime.now() + timedelta(seconds=90)),
        id="call_review_sweep",
        name="Transcribe and AI-review recorded calls",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )

    # Weekly call report email - Mondays 13:00 UTC.
    # The job itself is a no-op unless CALL_REVIEW_WEEKLY_REPORT_ENABLED is on.
    from app.services.call_report_service import send_weekly_reports
    scheduler.add_job(
        send_weekly_reports,
        trigger=CronTrigger(day_of_week="mon", hour=13, minute=0, timezone="UTC"),
        id="call_review_weekly_report",
        name="Email the weekly call report to managers",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )

    # BDC morning attention — 7:15 AM Eastern, before the 8 AM floor.
    from app.tasks.bdc_attention import run_bdc_morning_attention
    scheduler.add_job(
        run_bdc_morning_attention,
        trigger=CronTrigger(hour=7, minute=15, timezone="America/New_York"),
        id="bdc_morning_attention",
        name="BDC morning attention check (gpt-4o-mini)",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3 * 60 * 60,
    )

    from app.services.voice_service import move_twilio_recordings_to_azure
    scheduler.add_job(
        move_twilio_recordings_to_azure,
        trigger=IntervalTrigger(minutes=10, start_date=datetime.now() + timedelta(minutes=2)),
        id="recording_off_twilio",
        name="Copy call recordings to Azure and delete the Twilio copy",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=600,
    )

    logger.info("Background scheduler configured (lead sync + appointments only):")
    logger.info("  - AI call review sweep (every 5 minutes, only when CALL_REVIEW_AUTO_ENABLED)")
    logger.info("  - Google Sheets lead sync (every 2 minutes)")
    logger.info("  - Lead auto-assignment (every 2 minutes)")
    logger.info("  - Stale lead unassignment (every hour)")
    logger.info("  - Appointment reminders (every 5 minutes)")
    logger.info("  - Follow-up reminders (every 15 minutes)")
    logger.info("  - Missed appointment detection (every 30 minutes)")
    logger.info("  - Partner lead routing retry (every 2 minutes)")
    logger.info("  - CRM search backfill (every 24 hours, Azure only)")
    logger.info("  - BDC morning attention (7:15 AM America/New_York, gpt-4o-mini)")
    logger.info("  - Move call recordings off Twilio onto Azure (every 10 minutes)")
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
