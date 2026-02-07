"""
SMS Log Model - Twilio SMS Message Records
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.user import User
    from app.models.dealership import Dealership


class MessageDirection(str, Enum):
    """Message direction"""
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class SMSStatus(str, Enum):
    """SMS delivery status - matches Twilio statuses"""
    QUEUED = "queued"           # Message is queued for sending
    SENDING = "sending"         # Message is being sent
    SENT = "sent"               # Message sent to carrier
    DELIVERED = "delivered"     # Message delivered to recipient
    UNDELIVERED = "undelivered" # Message could not be delivered
    FAILED = "failed"           # Message failed to send
    RECEIVED = "received"       # Inbound message received


class SMSLog(Base):
    """
    SMS log model for Twilio messaging.
    Records all inbound and outbound SMS messages.
    """
    
    __tablename__ = "sms_logs"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Related lead (matched by phone number)
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # User who sent the message (for outbound)
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
    
    # Twilio message identifier
    twilio_message_sid: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True
    )
    
    # Message details
    direction: Mapped[MessageDirection] = mapped_column(
        SQLEnum(MessageDirection),
        nullable=False,
        index=True
    )
    from_number: Mapped[str] = mapped_column(String(20), nullable=False)
    to_number: Mapped[str] = mapped_column(String(20), nullable=False)
    
    # Message content
    body: Mapped[str] = mapped_column(Text, nullable=False)
    
    # MMS attachments (list of URLs)
    media_urls: Mapped[dict] = mapped_column(
        JSONB,
        default=list,
        nullable=False
    )
    
    # Delivery status
    status: Mapped[SMSStatus] = mapped_column(
        SQLEnum(SMSStatus),
        nullable=False,
        default=SMSStatus.QUEUED,
        index=True
    )
    error_code: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    
    # Read status (for inbound messages)
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Timestamps
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    delivered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    received_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
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
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True
    )
    
    # Relationships
    lead: Mapped[Optional["Lead"]] = relationship(
        "Lead",
        back_populates="sms_logs",
        lazy="noload"
    )
    user: Mapped[Optional["User"]] = relationship(
        "User",
        lazy="noload"
    )
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        preview = self.body[:30] + "..." if len(self.body) > 30 else self.body
        return f"<SMSLog {self.direction.value} '{preview}'>"
