"""
AI Outbound Call Model - Tracks automated outbound calls to new leads
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.dealership import Dealership
    from app.models.call_log import CallLog


class AiOutboundCall(Base):
    """
    AI Outbound Call tracking - one row per lead for automated call attempts.
    Ensures idempotency and tracks state/outcome.
    """
    
    __tablename__ = "ai_outbound_calls"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # One AI call attempt per lead (unique constraint)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True
    )
    
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Status: pending, dialing, in_progress, completed, failed, 
    # skipped_quiet_hours, skipped_no_phone, skipped_no_dealership
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True
    )
    
    twilio_call_sid: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        index=True
    )
    
    call_log_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("call_logs.id", ondelete="SET NULL"),
        nullable=True
    )
    
    customer_phone: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True
    )
    
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Outcome: qualified, booked, no_answer, voicemail, customer_declined, etc.
    outcome: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True
    )
    
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    
    # Store qualification data, appointment details, transcript summary, etc.
    meta_data: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        nullable=False
    )
    
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
    lead: Mapped["Lead"] = relationship(
        "Lead",
        back_populates="ai_outbound_call",
        lazy="noload"
    )
    
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        lazy="noload"
    )
    
    call_log: Mapped[Optional["CallLog"]] = relationship(
        "CallLog",
        lazy="noload"
    )


# Composite index for queries by status and creation time
Index(
    "ix_ai_outbound_calls_status_created",
    AiOutboundCall.status,
    AiOutboundCall.created_at
)
