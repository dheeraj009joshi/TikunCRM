"""One delivery of a lead to a single partner store for a single brand."""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timezone import utc_now
from app.db.database import Base

DELIVERY_DELIVERED = "delivered"
DELIVERY_ATTEMPTING = "attempting"
DELIVERY_CONTACTED = "contacted"
DELIVERY_WORKING = "working"
DELIVERY_APPOINTMENT_SET = "appointment_set"
DELIVERY_CONFIRMED = "confirmed"
DELIVERY_SHOWED = "showed"
DELIVERY_SOLD = "sold"
DELIVERY_NO_SHOW = "no_show"
DELIVERY_DEAD = "dead"
DELIVERY_RETURNED = "returned"

DELIVERY_STATUSES = frozenset({
    DELIVERY_DELIVERED,
    DELIVERY_ATTEMPTING,
    DELIVERY_CONTACTED,
    DELIVERY_WORKING,
    DELIVERY_APPOINTMENT_SET,
    DELIVERY_CONFIRMED,
    DELIVERY_SHOWED,
    DELIVERY_SOLD,
    DELIVERY_NO_SHOW,
    DELIVERY_DEAD,
    DELIVERY_RETURNED,
})

RELEASED_STATUSES = frozenset({DELIVERY_DEAD, DELIVERY_RETURNED})
LOCKING_STATUSES = frozenset(DELIVERY_STATUSES - RELEASED_STATUSES)
AGENT_OPEN_STATUSES = frozenset({
    DELIVERY_DELIVERED,
    DELIVERY_ATTEMPTING,
    DELIVERY_CONTACTED,
    DELIVERY_WORKING,
    DELIVERY_APPOINTMENT_SET,
    DELIVERY_CONFIRMED,
})

BDC_DESK_STATUSES = frozenset({
    DELIVERY_ATTEMPTING,
    DELIVERY_CONTACTED,
    DELIVERY_WORKING,
    DELIVERY_APPOINTMENT_SET,
    DELIVERY_CONFIRMED,
    DELIVERY_SHOWED,
    DELIVERY_SOLD,
    DELIVERY_NO_SHOW,
    DELIVERY_DEAD,
})

LEADS_ONLY_PORTAL_STATUSES = frozenset({
    DELIVERY_WORKING,
    DELIVERY_SHOWED,
    DELIVERY_SOLD,
    DELIVERY_DEAD,
})


class LeadDelivery(Base):
    __tablename__ = "lead_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand: Mapped[str] = mapped_column(String(100), nullable=False)
    brand_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    partner_store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    program_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    bdc_agent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    delivered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=False
    )
