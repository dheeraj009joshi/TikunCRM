"""
Notification Service
Handles creating and managing notifications
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationType
from app.models.user import User


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
    ) -> Notification:
        """
        Create a new notification for a user.
        
        Args:
            user_id: The ID of the user to notify
            notification_type: Type of notification
            title: Notification title
            message: Optional message/preview
            link: Optional URL path to navigate to
            related_id: Optional ID of related entity
            related_type: Optional type of related entity
            
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
            created_at=datetime.utcnow(),
        )
        
        self.db.add(notification)
        await self.db.flush()
        
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
