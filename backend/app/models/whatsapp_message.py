"""
WhatsApp Message Models - Baileys WhatsApp Integration
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, Boolean, Integer, TypeDecorator
from sqlalchemy.dialects.postgresql import UUID, JSONB, ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now
from app.models.whatsapp_log import WhatsAppDirection, WhatsAppStatus

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.customer import Customer
    from app.models.user import User
    from app.models.dealership import Dealership


class WhatsAppChannel(str, Enum):
    BAILEYS = "baileys"
    TWILIO = "twilio"


class _WhatsAppChannelEnumType(TypeDecorator):
    """Ensures PostgreSQL receives enum value."""
    impl = ENUM("baileys", "twilio", name="whatsappchannel", create_type=False)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return value.value if hasattr(value, "value") else value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return WhatsAppChannel(value) if isinstance(value, str) else value


class _WhatsAppDirectionEnumType(TypeDecorator):
    """Ensures PostgreSQL receives enum value."""
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
    """Ensures PostgreSQL receives enum value."""
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


class WhatsAppMessage(Base):
    """
    WhatsApp message model for Baileys integration.
    Stores all inbound and outbound messages via Baileys.
    """
    __tablename__ = "whatsapp_messages"

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
    
    # Baileys-specific
    wa_message_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
        index=True
    )
    channel: Mapped[WhatsAppChannel] = mapped_column(
        _WhatsAppChannelEnumType(),
        nullable=False,
        default=WhatsAppChannel.BAILEYS
    )
    
    # Phone numbers
    phone_number: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True
    )
    from_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    to_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # Message content
    direction: Mapped[WhatsAppDirection] = mapped_column(
        _WhatsAppDirectionEnumType(),
        nullable=False,
        index=True
    )
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    media_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    media_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    
    # Status
    status: Mapped[WhatsAppStatus] = mapped_column(
        _WhatsAppStatusEnumType(),
        nullable=False,
        default=WhatsAppStatus.QUEUED,
        index=True
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Bulk send tracking
    bulk_send_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("whatsapp_bulk_sends.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Read tracking
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
    meta_data: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # Relationships
    customer: Mapped[Optional["Customer"]] = relationship("Customer", lazy="noload")
    lead: Mapped[Optional["Lead"]] = relationship("Lead", lazy="noload")
    user: Mapped[Optional["User"]] = relationship("User", lazy="noload")
    dealership: Mapped[Optional["Dealership"]] = relationship("Dealership", lazy="noload")
    bulk_send: Mapped[Optional["WhatsAppBulkSend"]] = relationship(
        "WhatsAppBulkSend",
        back_populates="messages",
        lazy="noload"
    )

    def __repr__(self) -> str:
        preview = (self.body[:30] + "...") if self.body and len(self.body) > 30 else (self.body or "")
        return f"<WhatsAppMessage {self.direction.value} '{preview}'>"


class WhatsAppBulkSend(Base):
    """
    Tracks bulk message send campaigns.
    """
    __tablename__ = "whatsapp_bulk_sends"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    message_template: Mapped[str] = mapped_column(Text, nullable=False)
    filter_criteria: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        nullable=False
    )
    
    # Stats
    total_recipients: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    delivered_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    
    # Status: pending, in_progress, completed, cancelled
    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
        index=True
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True
    )

    # Relationships
    user: Mapped["User"] = relationship("User", lazy="noload")
    dealership: Mapped[Optional["Dealership"]] = relationship("Dealership", lazy="noload")
    messages: Mapped[list["WhatsAppMessage"]] = relationship(
        "WhatsAppMessage",
        back_populates="bulk_send",
        lazy="noload"
    )

    def __repr__(self) -> str:
        return f"<WhatsAppBulkSend {self.status} recipients={self.total_recipients}>"


class WhatsAppConnection(Base):
    """
    Tracks WhatsApp connection state for Baileys.
    """
    __tablename__ = "whatsapp_connections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20),
        default="disconnected",
        nullable=False,
        index=True
    )
    last_connected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    last_disconnected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    session_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # Relationships
    dealership: Mapped[Optional["Dealership"]] = relationship("Dealership", lazy="noload")

    def __repr__(self) -> str:
        return f"<WhatsAppConnection {self.status} phone={self.phone_number}>"
