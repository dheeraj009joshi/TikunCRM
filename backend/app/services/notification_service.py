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
    ) -> Notification:
        """
        Create a new notification for a user.
        Also sends a push notification if the user has push enabled.
        
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
