"""
Notification Service
Handles creating and managing notifications
Also sends web push notifications and WebSocket events when configured
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationType
from app.models.user import User
from app.core.websocket_manager import ws_manager
from app.core.timezone import utc_now

logger = logging.getLogger(__name__)


class NotificationService:
    """Service for creating and managing notifications"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_notification(
        self,
        user_id: UUID,
        notification_type: NotificationType,
        title: str,
        message: Optional[str] = None,
        link: Optional[str] = None,
        related_id: Optional[UUID] = None,
        related_type: Optional[str] = None,
        meta_data: Optional[Dict[str, Any]] = None,
        send_push: bool = True,
        send_email: bool = True,  # Send email for all notifications by default
        send_sms: bool = False,
    ) -> Notification:
        """
        Create a new notification for a user.
        Supports multi-channel delivery: push, email, and SMS.
        
        Args:
            user_id: The ID of the user to notify
            notification_type: Type of notification
            title: Notification title
            message: Optional message/preview
            link: Optional URL path to navigate to
            related_id: Optional ID of related entity
            related_type: Optional type of related entity
            meta_data: Optional additional metadata
            send_push: Whether to send a push notification (default True)
            send_email: Whether to send an email notification (default False)
            send_sms: Whether to send an SMS notification (default False)
            
        Returns:
            The created notification
        """
        notification = Notification(
            user_id=user_id,
            type=notification_type,
            title=title,
            message=message,
            link=link,
            related_id=related_id,
            related_type=related_type,
            created_at=utc_now(),
        )
        
        self.db.add(notification)
        await self.db.flush()
        
        # Get user for email and SMS
        user = None
        if send_email or send_sms:
            user_result = await self.db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
        
        # Send push notification if enabled
        if send_push:
            try:
                from app.services.push_service import push_service
                
                if push_service.is_configured:
                    await push_service.send_to_user(
                        db=self.db,
                        user_id=user_id,
                        title=title,
                        body=message or "",
                        url=link,
                        tag=f"{notification_type.value}-{related_id}" if related_id else None,
                        data={
                            "notification_id": str(notification.id),
                            "type": notification_type.value,
                            "related_id": str(related_id) if related_id else None,
                            "related_type": related_type,
                        }
                    )
            except Exception as e:
                # Don't fail notification creation if push fails
                logger.warning(f"Failed to send push notification: {e}")
        
        # Send email notification if enabled
        if send_email and user and user.email:
            try:
                from app.services.email_notifier import email_notifier
                
                if email_notifier.is_configured:
                    # Simple email notification - could be enhanced with HTML templates
                    await email_notifier.send_notification_email(
                        to_email=user.email,
                        to_name=f"{user.first_name} {user.last_name}",
                        subject=title,
                        message=message or title,
                        link=link
                    )
            except Exception as e:
                logger.warning(f"Failed to send email notification: {e}")
        
        # Send SMS notification if enabled
        if send_sms and user and user.phone:
            try:
                from app.services.sms_service import sms_service
                
                if sms_service.is_configured:
                    # Format SMS message: title + message (limited to 160 chars)
                    sms_text = f"{title}"
                    if message:
                        sms_text = f"{title}: {message}"
                    # Truncate to 160 characters for standard SMS
                    sms_text = sms_text[:160]
                    
                    await sms_service.send_sms(user.phone, sms_text)
            except Exception as e:
                logger.warning(f"Failed to send SMS notification: {e}")
        
        # Send WebSocket event for real-time updates
        try:
            await ws_manager.send_to_user(
                str(user_id),
                {
                    "type": "notification:new",
                    "data": {
                        "id": str(notification.id),
                        "notification_type": notification_type.value,
                        "title": title,
                        "message": message,
                        "link": link,
                        "related_id": str(related_id) if related_id else None,
                        "related_type": related_type,
                        "is_read": False,
                        "created_at": notification.created_at.isoformat(),
                    }
                }
            )
        except Exception as e:
            # Don't fail notification creation if WebSocket fails
            logger.warning(f"Failed to send WebSocket notification: {e}")
        
        return notification
    
    async def notify_email_received(
        self,
        user_id: UUID,
        lead_name: str,
        lead_id: UUID,
        email_preview: Optional[str] = None,
    ) -> Notification:
        """
        Create notification for a received email reply.
        
        Args:
            user_id: User who should receive the notification
            lead_name: Name of the lead who sent the email
            lead_id: ID of the lead
            email_preview: Preview of the email content
        """
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.EMAIL_RECEIVED,
            title=f"New email from {lead_name}",
            message=email_preview[:200] if email_preview else None,
            link=f"/leads/{lead_id}",
            related_id=lead_id,
            related_type="lead",
        )
    
    async def notify_lead_assigned(
        self,
        user_id: UUID,
        lead_name: str,
        lead_id: UUID,
        assigned_by: Optional[str] = None,
    ) -> Notification:
        """
        Create notification for lead assignment.
        
        Args:
            user_id: User who the lead was assigned to
            lead_name: Name of the lead
            lead_id: ID of the lead
            assigned_by: Name of the user who assigned the lead
        """
        title = f"New lead assigned: {lead_name}"
        message = f"Assigned by {assigned_by}" if assigned_by else None
        
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.LEAD_ASSIGNED,
            title=title,
            message=message,
            link=f"/leads/{lead_id}",
            related_id=lead_id,
            related_type="lead",
        )
    
    async def notify_follow_up_due(
        self,
        user_id: UUID,
        lead_name: str,
        lead_id: UUID,
        follow_up_id: UUID,
        due_time: datetime,
    ) -> Notification:
        """
        Create notification for upcoming follow-up.
        
        Args:
            user_id: User who has the follow-up
            lead_name: Name of the lead
            lead_id: ID of the lead
            follow_up_id: ID of the follow-up
            due_time: When the follow-up is due
        """
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.FOLLOW_UP_DUE,
            title=f"Follow-up due: {lead_name}",
            message=f"Due at {due_time.strftime('%I:%M %p')}",
            link=f"/leads/{lead_id}",
            related_id=follow_up_id,
            related_type="follow_up",
        )
    
    async def notify_follow_up_overdue(
        self,
        user_id: UUID,
        lead_name: str,
        lead_id: UUID,
        follow_up_id: UUID,
    ) -> Notification:
        """
        Create notification for overdue follow-up.
        """
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.FOLLOW_UP_OVERDUE,
            title=f"Overdue follow-up: {lead_name}",
            message="This follow-up is past due",
            link=f"/leads/{lead_id}",
            related_id=follow_up_id,
            related_type="follow_up",
        )
    
    async def create_system_notification(
        self,
        user_id: UUID,
        title: str,
        message: Optional[str] = None,
        link: Optional[str] = None,
    ) -> Notification:
        """
        Create a system notification.
        """
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.SYSTEM,
            title=title,
            message=message,
            link=link,
        )
    
    async def notify_appointment_reminder(
        self,
        user_id: UUID,
        lead_name: str,
        lead_id: UUID,
        appointment_id: UUID,
        scheduled_time: datetime,
        location: Optional[str] = None,
    ) -> Notification:
        """
        Create notification for upcoming appointment.
        Sends via push + email + SMS.
        
        Args:
            user_id: User who has the appointment
            lead_name: Name of the lead
            lead_id: ID of the lead
            appointment_id: ID of the appointment
            scheduled_time: When the appointment is scheduled
            location: Optional appointment location
        """
        message = f"Appointment with {lead_name} in 1 hour"
        if location:
            message += f" at {location}"
        
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.APPOINTMENT_REMINDER,
            title=f"Appointment Reminder: {lead_name}",
            message=message,
            link=f"/leads/{lead_id}",
            related_id=appointment_id,
            related_type="appointment",
            send_push=True,
            send_email=True,
            send_sms=True,
        )
    
    async def notify_appointment_missed(
        self,
        user_id: UUID,
        lead_name: str,
        lead_id: UUID,
        appointment_id: UUID,
    ) -> Notification:
        """
        Create notification for missed appointment.
        Sends via push + email.
        
        Args:
            user_id: User who missed the appointment
            lead_name: Name of the lead
            lead_id: ID of the lead
            appointment_id: ID of the appointment
        """
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.APPOINTMENT_MISSED,
            title=f"Missed Appointment: {lead_name}",
            message="This appointment was not completed and has been marked as no-show",
            link=f"/leads/{lead_id}",
            related_id=appointment_id,
            related_type="appointment",
            send_push=True,
            send_email=True,
            send_sms=False,  # Don't spam SMS for missed appointments
        )
    
    async def notify_new_lead_to_dealership(
        self,
        dealership_id: UUID,
        lead_name: str,
        lead_id: UUID,
        lead_source: Optional[str] = None,
    ) -> List[Notification]:
        """
        Broadcast new lead notification to all active users in a dealership.
        Sends via push + SMS to all team members.
        
        Args:
            dealership_id: Dealership ID
            lead_name: Name of the new lead
            lead_id: ID of the lead
            lead_source: Source of the lead (e.g., "google_sheets", "manual")
            
        Returns:
            List of created notifications
        """
        # Get all active users in the dealership
        from app.models.user import User
        result = await self.db.execute(
            select(User).where(
                User.dealership_id == dealership_id,
                User.is_active == True
            )
        )
        users = result.scalars().all()
        
        notifications = []
        source_msg = f" from {lead_source}" if lead_source else ""
        
        for user in users:
            try:
                notification = await self.create_notification(
                    user_id=user.id,
                    notification_type=NotificationType.NEW_LEAD,
                    title=f"New Lead: {lead_name}",
                    message=f"A new lead{source_msg} has been added to your dealership",
                    link=f"/leads/{lead_id}",
                    related_id=lead_id,
                    related_type="lead",
                    send_push=True,
                    send_email=True,  # Send email for all notifications
                    send_sms=True,  # SMS to all team members
                )
                notifications.append(notification)
            except Exception as e:
                logger.error(f"Failed to notify user {user.id} about new lead: {e}")
        
        logger.info(f"Sent new lead notifications to {len(notifications)} users in dealership {dealership_id}")
        return notifications
    
    async def notify_lead_assigned_to_dealership(
        self,
        lead_id: UUID,
        lead_name: str,
        dealership_id: UUID,
        performer_name: Optional[str] = None,
        source: Optional[str] = None,
    ) -> List[Notification]:
        """
        Notify all active users in a dealership that a new lead was added to their dealership.
        Used when a lead is created or assigned to a dealership (single, bulk, or auto-assign).
        """
        result = await self.db.execute(
            select(User).where(
                User.dealership_id == dealership_id,
                User.is_active == True,
            )
        )
        users = result.scalars().all()
        notifications = []
        
        # Build notification message
        if source:
            message = f"New lead: {lead_name} (from {source})"
        else:
            message = f"New lead: {lead_name}"
        
        if performer_name:
            message += f" added by {performer_name}"
        
        link = f"/leads/{lead_id}"
        for user in users:
            try:
                notification = await self.create_notification(
                    user_id=user.id,
                    notification_type=NotificationType.NEW_LEAD,
                    title="New lead came in",
                    message=message,
                    link=link,
                    related_id=lead_id,
                    related_type="lead",
                    meta_data={"lead_id": str(lead_id), "lead_name": lead_name, "performer_name": performer_name, "source": source},
                    send_push=True,
                    send_email=True,  # Send email notification for new leads
                    send_sms=False,
                )
                notifications.append(notification)
            except Exception as e:
                logger.warning("Failed to notify user %s about lead assigned to dealership: %s", user.id, e)
        logger.info("Sent lead-assigned-to-dealership notifications to %s users in dealership %s", len(notifications), dealership_id)
        return notifications
    
    async def notify_admin_reminder_to_salesperson(
        self,
        user_id: UUID,
        admin_name: str,
        custom_message: Optional[str] = None,
        pending_tasks: Optional[Dict[str, Any]] = None,
    ) -> Notification:
        """
        Admin/Owner sends notification to salesperson about pending tasks.
        Sends via all channels (push + email + SMS).
        
        Args:
            user_id: Salesperson user ID
            admin_name: Name of the admin sending the notification
            custom_message: Optional custom message from admin
            pending_tasks: Optional dict with pending follow-ups and appointments
            
        Returns:
            Created notification
        """
        # Build message
        title = f"Reminder from {admin_name}"
        
        message_parts = []
        if custom_message:
            message_parts.append(custom_message)
        
        if pending_tasks:
            overdue_followups = pending_tasks.get("overdue_followups", [])
            overdue_appointments = pending_tasks.get("overdue_appointments", [])
            
            if overdue_followups:
                message_parts.append(f"{len(overdue_followups)} overdue follow-up(s)")
            if overdue_appointments:
                message_parts.append(f"{len(overdue_appointments)} overdue appointment(s)")
        
        message = " | ".join(message_parts) if message_parts else "Please check your pending tasks"
        
        return await self.create_notification(
            user_id=user_id,
            notification_type=NotificationType.ADMIN_REMINDER,
            title=title,
            message=message,
            link="/follow-ups",  # Link to follow-ups page
            meta_data=pending_tasks,
            send_push=True,
            send_email=True,
            send_sms=True,
        )
    
    async def get_unread_count(self, user_id: UUID) -> int:
        """Get the number of unread notifications for a user."""
        from sqlalchemy import func
        
        result = await self.db.execute(
            select(func.count()).where(
                Notification.user_id == user_id,
                Notification.is_read == False
            )
        )
        return result.scalar() or 0

    async def send_skate_alert(
        self,
        lead_id: UUID,
        lead_name: str,
        dealership_id: UUID,
        assigned_to_user_id: UUID,
        assigned_to_name: str,
        performer_name: str,
        action: str,
        performer_user_id: UUID,
    ) -> None:
        """
        Send SKATE ALERT when a salesperson tries to act on a lead assigned to another.
        Notifies the lead owner and every member of the dealership (push + in-app).
        Clicking the notification navigates to the lead.
        """
        link = f"/leads/{lead_id}"

        # Notify lead owner (assigned salesperson): "This salesperson tried to skate your lead {lead name}"
        title_owner = "SKATE ALERT"
        message_owner = f"{performer_name} tried to skate your lead: {lead_name}"
        await self.create_notification(
            user_id=assigned_to_user_id,
            notification_type=NotificationType.SKATE_ALERT,
            title=title_owner,
            message=message_owner,
            link=link,
            related_id=lead_id,
            related_type="lead",
            meta_data={
                "lead_id": str(lead_id),
                "lead_name": lead_name,
                "assigned_to_name": assigned_to_name,
                "performer_name": performer_name,
                "action": action,
            },
            send_push=True,
            send_email=True,  # Send email notification for SKATE alerts to lead owner
        )

        # Notify all dealership members (so everyone sees the alert)
        result = await self.db.execute(
            select(User.id).where(
                User.dealership_id == dealership_id,
                User.is_active == True,
            )
        )
        dealership_user_ids = [row[0] for row in result.fetchall()]

        # Notify other dealership members: "This salesperson tried to skate this lead {lead name} assigned to {assigned_to_name}"
        title_team = "SKATE ALERT"
        message_team = f"{performer_name} tried to skate this lead {lead_name} assigned to {assigned_to_name}"
        # Notify every other dealership member (owner already got their message above)
        for user_id in dealership_user_ids:
            if user_id == assigned_to_user_id:
                continue  # already notified above with owner message
            await self.create_notification(
                user_id=user_id,
                notification_type=NotificationType.SKATE_ALERT,
                title=title_team,
                message=message_team,
                link=link,
                related_id=lead_id,
                related_type="lead",
                meta_data={
                    "lead_id": str(lead_id),
                    "lead_name": lead_name,
                    "assigned_to_name": assigned_to_name,
                    "performer_name": performer_name,
                    "action": action,
                },
                send_push=True,
                send_email=True,  # Send email for all SKATE alerts
            )


async def send_skate_alert_background(
    lead_id: UUID,
    lead_name: str,
    dealership_id: UUID,
    assigned_to_user_id: UUID,
    assigned_to_name: str,
    performer_name: str,
    action: str,
    performer_user_id: UUID,
) -> None:
    """
    Send SKATE notifications in a background task (own DB session).
    Notifies lead owner + entire dealership team (including the performer).
    Does not block the API response.
    """
    import traceback
    from app.db.database import async_session_maker
    logger.info("send_skate_alert_background started: lead_id=%s dealership_id=%s", lead_id, dealership_id)
    async with async_session_maker() as db:
        try:
            service = NotificationService(db)
            await service.send_skate_alert(
                lead_id=lead_id,
                lead_name=lead_name,
                dealership_id=dealership_id,
                assigned_to_user_id=assigned_to_user_id,
                assigned_to_name=assigned_to_name,
                performer_name=performer_name,
                action=action,
                performer_user_id=performer_user_id,
            )
            await db.commit()
            logger.info("send_skate_alert_background completed: lead_id=%s", lead_id)
            await emit_badges_refresh(notifications=True)
        except Exception as e:
            await db.rollback()
            logger.warning("send_skate_alert_background failed: %s\n%s", e, traceback.format_exc())


async def notify_lead_assigned_to_dealership_background(
    lead_id: UUID,
    lead_name: str,
    dealership_id: UUID,
    performer_name: Optional[str] = None,
    source: Optional[str] = None,
) -> None:
    """
    Notify all dealership members that a new lead was added to their dealership.
    Runs in a background task with its own DB session. Does not block the API response.
    """
    import traceback
    from app.db.database import async_session_maker
    logger.info("notify_lead_assigned_to_dealership_background started: lead_id=%s dealership_id=%s source=%s", lead_id, dealership_id, source)
    async with async_session_maker() as db:
        try:
            service = NotificationService(db)
            await service.notify_lead_assigned_to_dealership(
                lead_id=lead_id,
                lead_name=lead_name,
                dealership_id=dealership_id,
                performer_name=performer_name,
                source=source,
            )
            await db.commit()
            logger.info("notify_lead_assigned_to_dealership_background completed: lead_id=%s", lead_id)
            await emit_badges_refresh(notifications=True)
        except Exception as e:
            await db.rollback()
            logger.warning("notify_lead_assigned_to_dealership_background failed: %s\n%s", e, traceback.format_exc())


# Standalone WebSocket event helpers (can be used without NotificationService instance)

async def emit_lead_updated(lead_id: str, dealership_id: Optional[str], update_type: str, data: dict):
    """
    Emit a lead update event to all users who might be viewing this lead.
    
    Args:
        lead_id: The ID of the lead that was updated
        dealership_id: The dealership ID (for broadcasting to dealership users)
        update_type: Type of update (assigned, status_changed, note_added, etc.)
        data: Additional data about the update
    """
    try:
        message = {
            "type": "lead:updated",
            "data": {
                "lead_id": lead_id,
                "update_type": update_type,
                **data
            }
        }
        
        if dealership_id:
            # Broadcast to all users in the dealership
            await ws_manager.broadcast_to_dealership(dealership_id, message)
        else:
            # Broadcast to all connected users (for unassigned pool leads)
            await ws_manager.broadcast_all(message)
    except Exception as e:
        logger.warning(f"Failed to emit lead:updated WebSocket event: {e}")


async def emit_activity_added(lead_id: str, dealership_id: Optional[str], activity_data: dict):
    """
    Emit an activity event when a new activity is added to a lead.
    """
    try:
        message = {
            "type": "activity:new",
            "data": {
                "lead_id": lead_id,
                **activity_data
            }
        }
        
        if dealership_id:
            await ws_manager.broadcast_to_dealership(dealership_id, message)
        else:
            await ws_manager.broadcast_all(message)
    except Exception as e:
        logger.warning(f"Failed to emit activity:new WebSocket event: {e}")


async def emit_badges_refresh(unassigned: bool = False, notifications: bool = False):
    """
    Emit a badges refresh event so sidebar numbers update via WebSocket.
    Frontend will refetch the relevant counts.
    """
    try:
        message = {
            "type": "badges:refresh",
            "data": {
                "unassigned": unassigned,
                "notifications": notifications,
            }
        }
        await ws_manager.broadcast_all(message)
    except Exception as e:
        logger.warning(f"Failed to emit badges:refresh WebSocket event: {e}")


async def emit_lead_created(lead_id: str, dealership_id: Optional[str], lead_data: dict):
    """
    Emit a lead created event when a new lead is added.
    Used by Google Sheets sync and manual lead creation.
    """
    try:
        message = {
            "type": "lead:created",
            "data": {
                "lead_id": lead_id,
                "dealership_id": dealership_id,
                **lead_data
            }
        }
        
        if dealership_id:
            # Broadcast to all users in the dealership
            await ws_manager.broadcast_to_dealership(dealership_id, message)
        else:
            # Broadcast to all connected users (for unassigned pool leads)
            await ws_manager.broadcast_all(message)
    except Exception as e:
        logger.warning(f"Failed to emit lead:created WebSocket event: {e}")
