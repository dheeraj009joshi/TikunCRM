"""
Call Log Model - Twilio Voice Call Records
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, Integer, Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.customer import Customer
    from app.models.user import User
    from app.models.dealership import Dealership


class CallDirection(str, Enum):
    """Call direction"""
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class CallStatus(str, Enum):
    """Call status - matches Twilio call statuses"""
    INITIATED = "initiated"      # Call is being placed
    RINGING = "ringing"          # Call is ringing
    IN_PROGRESS = "in-progress"  # Call is connected
    COMPLETED = "completed"      # Call ended normally
    BUSY = "busy"                # Called party was busy
    NO_ANSWER = "no-answer"      # No answer
    FAILED = "failed"            # Call failed
    CANCELED = "canceled"        # Call was canceled


class CallLog(Base):
    """
    Call log model for Twilio voice calls.
    Records all inbound and outbound calls with recording links.
    """
    
    __tablename__ = "call_logs"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Customer (person) for unified history
    customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    # Lead (opportunity) context when known
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # User who made/received the call
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Dealership context
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Twilio identifiers
    twilio_call_sid: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True
    )
    twilio_parent_call_sid: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True
    )
    
    # Call details (values_callable so PostgreSQL receives 'inbound'/'outbound', not enum names)
    direction: Mapped[CallDirection] = mapped_column(
        SQLEnum(CallDirection, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True
    )
    from_number: Mapped[str] = mapped_column(String(20), nullable=False)
    to_number: Mapped[str] = mapped_column(String(20), nullable=False)
    
    # Call status (values_callable so PostgreSQL receives lowercase enum values)
    status: Mapped[CallStatus] = mapped_column(
        SQLEnum(CallStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=CallStatus.INITIATED,
        index=True
    )
    
    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    answered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Duration in seconds
    duration_seconds: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False
    )
    
    # Recording (Azure Blob Storage URL)
    recording_url: Mapped[Optional[str]] = mapped_column(
        String(1000),
        nullable=True
    )
    recording_sid: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True
    )
    recording_duration_seconds: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True
    )
    
    # User notes after call
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Call outcome (for CRM tracking)
    outcome: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )  # e.g., "interested", "callback", "not_interested", "voicemail"
    
    # Additional metadata
    meta_data: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        nullable=False
    )
    
    # Was activity record created?
    activity_logged: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False
    )
    
    # Who actually answered the call (may differ from lead.assigned_to for ring groups)
    answered_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # For unknown callers - auto-created lead needs details after call
    requires_lead_details: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False
    )
    
    # Recording upload status tracking: pending, uploading, completed, failed
    recording_upload_status: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False
    )
    
    # Relationships
    customer: Mapped[Optional["Customer"]] = relationship(
        "Customer",
        lazy="noload"
    )
    lead: Mapped[Optional["Lead"]] = relationship(
        "Lead",
        back_populates="call_logs",
        lazy="noload"
    )
    user: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="call_logs",
        lazy="noload",
        foreign_keys=[user_id]
    )
    answered_by_user: Mapped[Optional["User"]] = relationship(
        "User",
        lazy="noload",
        foreign_keys=[answered_by]
    )
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        return f"<CallLog {self.direction.value} {self.status.value} {self.from_number} -> {self.to_number}>"
