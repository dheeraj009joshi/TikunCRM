"""
Activity Model - Immutable Audit Logging
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional, List

from app.core.timezone import utc_now

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.user import User


class ActivityType(str, Enum):
    """Types of trackable activities"""
    # Lead lifecycle
    LEAD_CREATED = "lead_created"
    LEAD_ASSIGNED = "lead_assigned"
    LEAD_REASSIGNED = "lead_reassigned"
    LEAD_UNASSIGNED = "lead_unassigned"
    STATUS_CHANGED = "status_changed"
    LEAD_DELETED = "lead_deleted"
    LEAD_UPDATED = "lead_updated"
    
    # Communication
    NOTE_ADDED = "note_added"
    CALL_LOGGED = "call_logged"
    EMAIL_SENT = "email_sent"
    EMAIL_RECEIVED = "email_received"
    SMS_SENT = "sms_sent"
    SMS_RECEIVED = "sms_received"
    WHATSAPP_SENT = "whatsapp_sent"
    WHATSAPP_RECEIVED = "whatsapp_received"
    
    # Follow-ups
    FOLLOW_UP_SCHEDULED = "follow_up_scheduled"
    FOLLOW_UP_COMPLETED = "follow_up_completed"
    FOLLOW_UP_MISSED = "follow_up_missed"
    
    # Appointments
    APPOINTMENT_SCHEDULED = "appointment_scheduled"
    APPOINTMENT_COMPLETED = "appointment_completed"
    APPOINTMENT_CANCELLED = "appointment_cancelled"
    
    # User actions
    USER_LOGIN = "user_login"
    USER_LOGOUT = "user_logout"
    
    # System
    IMPORT_COMPLETED = "import_completed"
    SYNC_COMPLETED = "sync_completed"


class Activity(Base):
    """
    Activity model for immutable audit logging.
    Every action in the system is recorded here.
    """
    
    __tablename__ = "activities"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # What type of activity
    type: Mapped[ActivityType] = mapped_column(
        SQLEnum(ActivityType),
        nullable=False,
        index=True
    )
    
    # Human-readable description
    description: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Who performed the action
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Which lead was affected (if applicable)
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    
    # Which dealership context (for filtering)
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Parent activity for replies (thread support)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    
    # Additional metadata (e.g., old_status, new_status, call_duration, etc.)
    meta_data: Mapped[dict] = mapped_column(JSONB, name="meta_data", default=dict, nullable=False)
    
    # IP address for security auditing (optional)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)
    
    # Timestamp (immutable) - use timezone-aware UTC
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True
    )
    
    # Relationships - use lazy="noload" to avoid N+1 queries
    user: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="activities",
        lazy="noload"
    )
    lead: Mapped[Optional["Lead"]] = relationship(
        "Lead",
        back_populates="activities",
        lazy="noload"
    )
    
    # Self-referential relationship for reply threading
    replies: Mapped[List["Activity"]] = relationship(
        "Activity",
        back_populates="parent",
        lazy="noload",
        cascade="all, delete-orphan"
    )
    parent: Mapped[Optional["Activity"]] = relationship(
        "Activity",
        back_populates="replies",
        remote_side=[id],
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        return f"<Activity {self.type.value} at {self.created_at}>"
