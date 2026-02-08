"""
Reminder and notification background tasks

Handles:
- Appointment reminders (1 hour before)
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
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_size=2,
        max_overflow=0,
        pool_pre_ping=True,
    )
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def send_appointment_reminders():
    """
    Check for appointments in the next hour and send reminders.
    Runs every 5 minutes.
    """
    logger.info("Starting appointment reminder task...")
    
    try:
        session_maker = get_reminder_session_maker()
        
        async with session_maker() as session:
            # Get appointments that:
            # 1. Are scheduled in the next hour
            # 2. Status is SCHEDULED or CONFIRMED
            # 3. Haven't had reminder sent yet
            now = utc_now()
            one_hour_from_now = now + timedelta(hours=1)
            
            result = await session.execute(
                select(Appointment)
                .where(
                    Appointment.scheduled_at >= now,
                    Appointment.scheduled_at <= one_hour_from_now,
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
                        sms_message = f"Reminder: You have an appointment in 1 hour at {time_str}{location_str}. See you soon!"
                        
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
    Check for follow-ups in the next hour and send reminders.
    Runs every 15 minutes.
    """
    logger.info("Starting follow-up reminder task...")
    
    try:
        session_maker = get_reminder_session_maker()
        
        async with session_maker() as session:
            # Get follow-ups that:
            # 1. Are scheduled in the next hour
            # 2. Status is PENDING
            # 3. Haven't had reminder sent yet
            now = utc_now()
            one_hour_from_now = now + timedelta(hours=1)
            
            result = await session.execute(
                select(FollowUp)
                .where(
                    FollowUp.scheduled_at >= now,
                    FollowUp.scheduled_at <= one_hour_from_now,
                    FollowUp.status == FollowUpStatus.PENDING,
                    FollowUp.reminder_sent == False
                )
            )
            follow_ups = result.scalars().all()
            
            if not follow_ups:
                logger.info("No follow-ups need reminders")
                return
            
            logger.info(f"Found {len(follow_ups)} follow-ups needing reminders")
            notification_service = NotificationService(session)
            
            for follow_up in follow_ups:
                try:
                    # Get lead info
                    lead_result = await session.execute(
                        select(Lead).where(Lead.id == follow_up.lead_id)
                    )
                    lead = lead_result.scalar_one_or_none()
                    
                    if not lead:
                        logger.warning(f"Lead not found for follow-up {follow_up.id}")
                        continue
                    
                    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
                    
                    # Send notification to assigned user (push + email + SMS)
                    if follow_up.assigned_to:
                        await notification_service.notify_follow_up_due(
                            user_id=follow_up.assigned_to,
                            lead_name=lead_name,
                            lead_id=lead.id,
                            follow_up_id=follow_up.id,
                            due_time=follow_up.scheduled_at
                        )
                        
                        # Also send SMS for follow-ups
                        user_result = await session.execute(
                            select(User).where(User.id == follow_up.assigned_to)
                        )
                        user = user_result.scalar_one_or_none()
                        
                        if user and user.phone and sms_service.is_configured:
                            time_str = follow_up.scheduled_at.strftime("%I:%M %p")
                            sms_message = f"Reminder: Follow-up with {lead_name} due in 1 hour at {time_str}"
                            
                            try:
                                await sms_service.send_sms(user.phone, sms_message)
                                logger.info(f"Sent SMS reminder for follow-up {follow_up.id}")
                            except Exception as e:
                                logger.error(f"Failed to send SMS for follow-up {follow_up.id}: {e}")
                        
                        logger.info(f"Sent reminder for follow-up {follow_up.id}")
                    
                    # Mark reminder as sent
                    follow_up.reminder_sent = True
                    
                except Exception as e:
                    logger.error(f"Error processing follow-up {follow_up.id}: {e}")
                    continue
            
            await session.commit()
            logger.info(f"Follow-up reminder task completed: {len(follow_ups)} reminders sent")
            
    except Exception as e:
        logger.error(f"Follow-up reminder task failed: {e}")


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
                    
                    # Send notification to assigned user
                    if appointment.assigned_to:
                        await notification_service.notify_appointment_missed(
                            user_id=appointment.assigned_to,
                            lead_name=lead_name,
                            lead_id=lead.id,
                            appointment_id=appointment.id
                        )
                        logger.info(f"Notified user {appointment.assigned_to} about missed appointment {appointment.id}")
                    
                    # Optionally notify dealership admin/owner
                    if lead.dealership_id:
                        # Get dealership admins/owners
                        from app.models.user import UserRole
                        admins_result = await session.execute(
                            select(User).where(
                                User.dealership_id == lead.dealership_id,
                                User.role.in_([UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]),
                                User.is_active == True
                            )
                        )
                        admins = admins_result.scalars().all()
                        
                        for admin in admins:
                            try:
                                await notification_service.create_notification(
                                    user_id=admin.id,
                                    notification_type=NotificationType.APPOINTMENT_MISSED,
                                    title=f"Missed Appointment: {lead_name}",
                                    message=f"Salesperson missed appointment scheduled for {appointment.scheduled_at.strftime('%I:%M %p')}",
                                    link=f"/leads/{lead.id}",
                                    related_id=appointment.id,
                                    related_type="appointment",
                                    send_push=True,
                                    send_email=True,
                                    send_sms=True,
                                )
                            except Exception as e:
                                logger.error(f"Failed to notify admin {admin.id}: {e}")
                    
                    logger.info(f"Marked appointment {appointment.id} as missed")
                    
                except Exception as e:
                    logger.error(f"Error processing missed appointment {appointment.id}: {e}")
                    continue
            
            await session.commit()
            logger.info(f"Missed appointment detection completed: {len(missed_appointments)} appointments processed")
            
    except Exception as e:
        logger.error(f"Missed appointment detection task failed: {e}")
