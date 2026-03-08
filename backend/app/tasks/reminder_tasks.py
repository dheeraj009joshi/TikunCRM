"""
Reminder and notification background tasks

Handles:
- Appointment reminders (2 hours before)
- Follow-up reminders (1 hour before)
- Missed appointment detection
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.timezone import utc_now
from app.db.database import get_engine_url_and_connect_args
from app.models.appointment import Appointment, AppointmentStatus
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead
from app.models.user import User
from app.models.activity import Activity, ActivityType
from app.models.notification import NotificationType
from app.services.notification_service import NotificationService
from app.services.sms_service import sms_service

logger = logging.getLogger(__name__)


def get_reminder_session_maker():
    """Create a dedicated engine and session maker for reminder tasks."""
    url, connect_args = get_engine_url_and_connect_args()
    engine = create_async_engine(
        url,
        echo=False,
        pool_size=2,
        max_overflow=0,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def send_appointment_reminders():
    """
    Check for appointments in the next 2 hours and send reminders.
    Runs every 5 minutes.
    """
    logger.info("Starting appointment reminder task...")
    
    try:
        session_maker = get_reminder_session_maker()
        
        async with session_maker() as session:
            # Get appointments that:
            # 1. Are scheduled in the next 2 hours
            # 2. Status is SCHEDULED or CONFIRMED
            # 3. Haven't had reminder sent yet
            now = utc_now()
            two_hours_from_now = now + timedelta(hours=2)
            
            result = await session.execute(
                select(Appointment)
                .where(
                    Appointment.scheduled_at >= now,
                    Appointment.scheduled_at <= two_hours_from_now,
                    Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]),
                    Appointment.reminder_sent == False
                )
            )
            appointments = result.scalars().all()
            
            if not appointments:
                logger.info("No appointments need reminders")
                return
            
            logger.info(f"Found {len(appointments)} appointments needing reminders")
            notification_service = NotificationService(session)
            
            for appointment in appointments:
                try:
                    # Get lead info
                    lead_result = await session.execute(
                        select(Lead).where(Lead.id == appointment.lead_id)
                    )
                    lead = lead_result.scalar_one_or_none()
                    
                    if not lead:
                        logger.warning(f"Lead not found for appointment {appointment.id}")
                        continue
                    
                    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
                    
                    # Send notification to assigned user (push + email + SMS)
                    if appointment.assigned_to:
                        await notification_service.notify_appointment_reminder(
                            user_id=appointment.assigned_to,
                            lead_name=lead_name,
                            lead_id=lead.id,
                            appointment_id=appointment.id,
                            scheduled_time=appointment.scheduled_at,
                            location=appointment.location
                        )
                        logger.info(f"Sent reminder to user {appointment.assigned_to} for appointment {appointment.id}")
                    
                    # Send SMS to lead (if they have a phone number)
                    if lead.phone and sms_service.is_configured:
                        time_str = appointment.scheduled_at.strftime("%I:%M %p")
                        location_str = f" at {appointment.location}" if appointment.location else ""
                        sms_message = f"Reminder: You have an appointment in 2 hours at {time_str}{location_str}. See you soon!"
                        
                        try:
                            await sms_service.send_sms(lead.phone, sms_message)
                            logger.info(f"Sent SMS reminder to lead {lead.id}")
                        except Exception as e:
                            logger.error(f"Failed to send SMS to lead {lead.id}: {e}")
                    
                    # Mark reminder as sent
                    appointment.reminder_sent = True
                    appointment.reminder_sent_at = now
                    
                except Exception as e:
                    logger.error(f"Error processing appointment {appointment.id}: {e}")
                    continue
            
            await session.commit()
            logger.info(f"Appointment reminder task completed: {len(appointments)} reminders sent")
            
    except Exception as e:
        logger.error(f"Appointment reminder task failed: {e}")


async def send_followup_reminders():
    """
    DISABLED: Follow-up reminder notifications are disabled per notification ruleset.
    This task is kept as a no-op for backward compatibility.
    """
    logger.info("Follow-up reminder task is DISABLED per notification ruleset")
    return


async def detect_missed_appointments():
    """
    Check for appointments that were missed (past due but not completed).
    Updates status to NO_SHOW and sends notifications.
    Runs every 30 minutes.
    """
    logger.info("Starting missed appointment detection task...")
    
    try:
        session_maker = get_reminder_session_maker()
        
        async with session_maker() as session:
            # Get appointments that:
            # 1. scheduled_at is at least 24 hours in the past (no change in status for 24h)
            # 2. Status is SCHEDULED or CONFIRMED (not completed/cancelled)
            now = utc_now()
            cutoff = now - timedelta(hours=24)
            
            result = await session.execute(
                select(Appointment)
                .where(
                    Appointment.scheduled_at < cutoff,
                    Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
                )
            )
            missed_appointments = result.scalars().all()
            
            if not missed_appointments:
                logger.info("No missed appointments found")
                return
            
            logger.info(f"Found {len(missed_appointments)} missed appointments")
            notification_service = NotificationService(session)
            
            for appointment in missed_appointments:
                try:
                    # Get lead info
                    lead_result = await session.execute(
                        select(Lead).where(Lead.id == appointment.lead_id)
                    )
                    lead = lead_result.scalar_one_or_none()
                    
                    if not lead:
                        logger.warning(f"Lead not found for appointment {appointment.id}")
                        continue
                    
                    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
                    
                    # Update appointment status to NO_SHOW
                    old_status = appointment.status
                    appointment.status = AppointmentStatus.NO_SHOW
                    
                    # Log activity
                    activity = Activity(
                        type=ActivityType.APPOINTMENT_CANCELLED,
                        description=f"Appointment marked as no-show (was scheduled for {appointment.scheduled_at.strftime('%I:%M %p')})",
                        user_id=None,  # System activity
                        lead_id=lead.id,
                        dealership_id=lead.dealership_id,
                        meta_data={
                            "appointment_id": str(appointment.id),
                            "scheduled_at": appointment.scheduled_at.isoformat(),
                            "old_status": old_status.value,
                            "new_status": AppointmentStatus.NO_SHOW.value,
                            "detected_by": "system"
                        }
                    )
                    session.add(activity)
                    
                    # DISABLED: Missed appointment notifications are disabled per notification ruleset
                    # Status will still be updated to NO_SHOW but no notifications sent
                    logger.info(f"Marked appointment {appointment.id} as missed (notifications disabled)")
                    
                    logger.info(f"Marked appointment {appointment.id} as missed")
                    
                except Exception as e:
                    logger.error(f"Error processing missed appointment {appointment.id}: {e}")
                    continue
            
            await session.commit()
            logger.info(f"Missed appointment detection completed: {len(missed_appointments)} appointments processed")
            
    except Exception as e:
        logger.error(f"Missed appointment detection task failed: {e}")
