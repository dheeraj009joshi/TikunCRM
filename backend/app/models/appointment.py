"""
Appointment Model - For scheduling calls, emails, and in-person meetings
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.user import User
    from app.models.dealership import Dealership


class AppointmentType(str, Enum):
    """Types of appointments"""
    PHONE_CALL = "phone_call"
    EMAIL = "email"
    IN_PERSON = "in_person"
    VIDEO_CALL = "video_call"
    OTHER = "other"


class AppointmentStatus(str, Enum):
    """Status of an appointment"""
    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    ARRIVED = "arrived"         # Customer has arrived
    IN_SHOWROOM = "in_showroom" # Customer is in showroom
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    RESCHEDULED = "rescheduled"
    SOLD = "sold"               # Converted/sold


class Appointment(Base):
    """
    Appointment model for scheduling interactions with leads.
    Can be phone calls, emails, in-person meetings, etc.
    """
    
    __tablename__ = "appointments"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Associated lead (optional - appointment might be internal)
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Dealership context
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    
    # Who created/scheduled this appointment
    scheduled_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Who is assigned to handle this appointment
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Appointment details
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    appointment_type: Mapped[AppointmentType] = mapped_column(
        SQLEnum(AppointmentType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=AppointmentType.PHONE_CALL
    )
    
    status: Mapped[AppointmentStatus] = mapped_column(
        SQLEnum(AppointmentStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=AppointmentStatus.SCHEDULED,
        index=True
    )
    
    # Scheduling
    scheduled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True
    )
    
    duration_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=30
    )
    
    # Location (for in-person) or meeting link (for video calls)
    location: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    meeting_link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    
    # Reminders
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Completion notes
    outcome_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=datetime.utcnow,
        nullable=False
    )
    
    # Relationships
    lead: Mapped[Optional["Lead"]] = relationship(
        "Lead",
        back_populates="appointments",
        lazy="noload"
    )
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        lazy="noload"
    )
    scheduled_by_user: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[scheduled_by],
        lazy="noload"
    )
    assigned_to_user: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[assigned_to],
        lazy="noload"
    )
    
    @property
    def is_past_due(self) -> bool:
        """Check if appointment is past its scheduled time"""
        return (
            self.status == AppointmentStatus.SCHEDULED and
            utc_now() > self.scheduled_at
        )
    
    @property
    def is_today(self) -> bool:
        """Check if appointment is scheduled for today"""
        now = utc_now()
        return (
            self.scheduled_at.year == now.year and
            self.scheduled_at.month == now.month and
            self.scheduled_at.day == now.day
        )
    
    def __repr__(self) -> str:
        return f"<Appointment {self.title} ({self.status.value}) at {self.scheduled_at}>"
