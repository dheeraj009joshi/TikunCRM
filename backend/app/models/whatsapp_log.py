"""
WhatsApp Log Model - Twilio WhatsApp Message Records
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, Boolean, TypeDecorator
from sqlalchemy.dialects.postgresql import UUID, JSONB, ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.customer import Customer
    from app.models.user import User
    from app.models.dealership import Dealership


class WhatsAppDirection(str, Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class WhatsAppStatus(str, Enum):
    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    UNDELIVERED = "undelivered"
    FAILED = "failed"
    RECEIVED = "received"


class _WhatsAppDirectionEnumType(TypeDecorator):
    """Ensures PostgreSQL receives enum value ('inbound'/'outbound'), not name ('INBOUND'/'OUTBOUND')."""
    impl = ENUM("inbound", "outbound", name="whatsappdirection", create_type=False)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return value.value if hasattr(value, "value") else value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return WhatsAppDirection(value) if isinstance(value, str) else value


class _WhatsAppStatusEnumType(TypeDecorator):
    """Ensures PostgreSQL receives enum value (e.g. 'queued'), not name ('QUEUED')."""
    impl = ENUM(
        "queued", "sending", "sent", "delivered", "read",
        "undelivered", "failed", "received",
        name="whatsappstatus", create_type=False
    )
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return value.value if hasattr(value, "value") else value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return WhatsAppStatus(value) if isinstance(value, str) else value


class WhatsAppLog(Base):
    """
    WhatsApp log model for Twilio WhatsApp messaging.
    Records all inbound and outbound WhatsApp messages.
    """
    __tablename__ = "whatsapp_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    twilio_message_sid: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True
    )
    direction: Mapped[WhatsAppDirection] = mapped_column(
        _WhatsAppDirectionEnumType(),
        nullable=False,
        index=True
    )
    from_number: Mapped[str] = mapped_column(String(20), nullable=False)
    to_number: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    media_urls: Mapped[dict] = mapped_column(
        JSONB,
        default=list,
        nullable=False
    )
    status: Mapped[WhatsAppStatus] = mapped_column(
        _WhatsAppStatusEnumType(),
        nullable=False,
        default=WhatsAppStatus.QUEUED,
        index=True
    )
    error_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    meta_data: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        nullable=False
    )
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

    customer: Mapped[Optional["Customer"]] = relationship("Customer", lazy="noload")
    lead: Mapped[Optional["Lead"]] = relationship(
        "Lead",
        back_populates="whatsapp_logs",
        lazy="noload"
    )
    user: Mapped[Optional["User"]] = relationship("User", lazy="noload")
    dealership: Mapped[Optional["Dealership"]] = relationship("Dealership", lazy="noload")

    def __repr__(self) -> str:
        preview = self.body[:30] + "..." if len(self.body) > 30 else self.body
        return f"<WhatsAppLog {self.direction.value} '{preview}'>"
