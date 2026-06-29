"""
Guest Model - a visitor profile captured (usually by a BDC agent) when an
appointment is booked. Auto-filled from the lead/customer, editable, and
shareable via a public QR link.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.customer import Customer
    from app.models.appointment import Appointment
    from app.models.user import User


class GuestStatus(str, Enum):
    """Lifecycle of a guest profile."""
    DRAFT = "draft"
    READY = "ready"
    CHECKED_IN = "checked_in"
    COMPLETED = "completed"


class Guest(Base):
    """A showroom guest profile linked to an appointment / lead / customer."""

    __tablename__ = "guests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # --- Snapshot (auto-filled, editable) ---
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    down_payment: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    vehicle_of_interest: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    trade_in: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- QR sharing ---
    share_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    share_revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=GuestStatus.DRAFT.value, server_default="draft")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=False
    )

    # --- Relationships ---
    lead: Mapped[Optional["Lead"]] = relationship("Lead", lazy="noload")
    customer: Mapped[Optional["Customer"]] = relationship("Customer", lazy="noload")
    appointment: Mapped[Optional["Appointment"]] = relationship("Appointment", lazy="noload")
    created_by_user: Mapped[Optional["User"]] = relationship("User", lazy="noload")

    def __repr__(self) -> str:
        return f"<Guest {self.full_name} ({self.status})>"
