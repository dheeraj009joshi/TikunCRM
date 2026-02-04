"""
Notification Model
For in-app notifications to users
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.user import User


class NotificationType(str, Enum):
    """Types of notifications. Values must match PostgreSQL notificationtype enum (uppercase)."""
    EMAIL_RECEIVED = "EMAIL_RECEIVED"      # New email reply from a lead
    LEAD_ASSIGNED = "LEAD_ASSIGNED"        # Lead was assigned to user
    LEAD_UPDATED = "LEAD_UPDATED"          # Lead status changed
    FOLLOW_UP_DUE = "FOLLOW_UP_DUE"        # Follow-up reminder
    FOLLOW_UP_OVERDUE = "FOLLOW_UP_OVERDUE"  # Missed follow-up
    SYSTEM = "SYSTEM"                       # System notifications
    MENTION = "MENTION"                     # User was mentioned
    APPOINTMENT_REMINDER = "APPOINTMENT_REMINDER"  # Appointment reminder
    APPOINTMENT_MISSED = "APPOINTMENT_MISSED"      # Missed appointment
    NEW_LEAD = "NEW_LEAD"                  # New lead in dealership
    ADMIN_REMINDER = "ADMIN_REMINDER"      # Admin reminder to salesperson
    SKATE_ALERT = "SKATE_ALERT"            # Another salesperson tried to act on assigned lead


class Notification(Base):
    """
    In-app notifications for users.
    Used for email replies, lead assignments, reminders, etc.
    """
    
    __tablename__ = "notifications"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Who receives this notification
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # Notification type
    type: Mapped[NotificationType] = mapped_column(
        SQLEnum(NotificationType),
        nullable=False,
        default=NotificationType.SYSTEM
    )
    
    # Content
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Notification title"
    )
    message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Notification body/preview"
    )
    
    # Link to related resource
    link: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="URL path to navigate to (e.g., /leads/123)"
    )
    
    # Related entity for quick lookups
    related_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
        comment="ID of related entity (lead_id, email_id, etc.)"
    )
    related_type: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="Type of related entity (lead, email, follow_up)"
    )
    
    # Status
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True  # For sorting by newest
    )
    
    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        return f"<Notification(user_id={self.user_id}, type={self.type.value}, title={self.title[:30]})>"
