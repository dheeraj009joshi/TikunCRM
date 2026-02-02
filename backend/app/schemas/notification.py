"""
Pydantic schemas for Notifications
"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.notification import NotificationType


class NotificationBase(BaseModel):
    """Base notification schema"""
    type: NotificationType
    title: str = Field(..., min_length=1, max_length=255)
    message: Optional[str] = None
    link: Optional[str] = Field(None, max_length=500)
    related_id: Optional[UUID] = None
    related_type: Optional[str] = Field(None, max_length=50)


class NotificationCreate(NotificationBase):
    """Schema for creating a notification"""
    user_id: UUID


class NotificationResponse(NotificationBase):
    """Schema for notification response"""
    id: UUID
    user_id: UUID
    is_read: bool
    read_at: Optional[datetime] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    """Schema for notification list with pagination"""
    items: List[NotificationResponse]
    total: int
    unread_count: int


class NotificationMarkReadRequest(BaseModel):
    """Schema for marking notifications as read"""
    notification_ids: List[UUID] = Field(..., min_length=1)


class NotificationStats(BaseModel):
    """Notification statistics for the current user"""
    total: int
    unread: int
    by_type: dict[str, int] = {}
