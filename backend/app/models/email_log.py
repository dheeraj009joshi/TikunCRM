"""
Email Log Model
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, Integer
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.user import User


class EmailDirection(str, Enum):
    """Email direction"""
    SENT = "sent"
    RECEIVED = "received"


class EmailDeliveryStatus(str, Enum):
    """Email delivery status (tracked via SendGrid webhooks)"""
    PENDING = "pending"       # Email queued for sending
    SENT = "sent"             # Accepted by SendGrid
    DELIVERED = "delivered"   # Delivered to recipient's mail server
    OPENED = "opened"         # Recipient opened the email
    CLICKED = "clicked"       # Recipient clicked a link
    BOUNCED = "bounced"       # Email bounced (hard or soft)
    DROPPED = "dropped"       # SendGrid dropped the email
    SPAM = "spam"             # Marked as spam
    FAILED = "failed"         # Failed to send


class EmailLog(Base):
    """Email communication log"""
    
    __tablename__ = "email_logs"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=True,  # Can be null for unmatched emails
        index=True
    )
    
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Standard email message ID for threading
    message_id: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, index=True)
    in_reply_to: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Gmail message ID for threading (legacy support)
    gmail_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    gmail_thread_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # SendGrid tracking
    sendgrid_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    
    direction: Mapped[EmailDirection] = mapped_column(
        SQLEnum(EmailDirection),
        nullable=False
    )
    
    from_email: Mapped[str] = mapped_column(String(255), nullable=False)
    to_email: Mapped[str] = mapped_column(String(255), nullable=False)
    cc_emails: Mapped[str] = mapped_column(Text, nullable=True)
    bcc_emails: Mapped[str] = mapped_column(Text, nullable=True)
    
    subject: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    body_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Plain text body
    body_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # HTML body
    
    # Attachments metadata
    attachments: Mapped[dict] = mapped_column(JSONB, default=list, nullable=False)
    
    # Status tracking
    is_read: Mapped[bool] = mapped_column(default=False, nullable=False)
    
    # Delivery tracking (via SendGrid webhooks)
    delivery_status: Mapped[Optional[EmailDeliveryStatus]] = mapped_column(
        SQLEnum(EmailDeliveryStatus),
        nullable=True,
        default=None
    )
    opened_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    clicked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    delivered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    bounce_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    open_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    click_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    received_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    
    # Relationships - use lazy="noload" to avoid N+1 queries
    lead: Mapped["Lead"] = relationship(
        "Lead",
        back_populates="email_logs",
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        return f"<EmailLog {self.direction.value} {self.subject}>"
