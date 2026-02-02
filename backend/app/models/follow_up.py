"""
Follow-Up Model
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.user import User


class FollowUpStatus(str, Enum):
    """Follow-up task statuses"""
    PENDING = "pending"
    COMPLETED = "completed"
    MISSED = "missed"
    CANCELLED = "cancelled"


class FollowUp(Base):
    """Follow-up task model for lead management"""
    
    __tablename__ = "follow_ups"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Which lead this follow-up is for
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # Who is responsible for this follow-up
    assigned_to: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # When the follow-up is scheduled
    scheduled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True
    )
    
    # Follow-up details
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    
    # Status tracking
    status: Mapped[FollowUpStatus] = mapped_column(
        SQLEnum(FollowUpStatus),
        nullable=False,
        default=FollowUpStatus.PENDING,
        index=True
    )
    
    # Completion details
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    completion_notes: Mapped[str] = mapped_column(Text, nullable=True)
    
    # Reminder settings
    reminder_sent: Mapped[bool] = mapped_column(default=False, nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )
    
    # Relationships
    lead: Mapped["Lead"] = relationship(
        "Lead",
        back_populates="follow_ups",
        lazy="selectin"
    )
    assigned_to_user: Mapped["User"] = relationship(
        "User",
        back_populates="follow_ups",
        lazy="selectin"
    )
    
    def __repr__(self) -> str:
        return f"<FollowUp {self.id} for Lead {self.lead_id} at {self.scheduled_at}>"
