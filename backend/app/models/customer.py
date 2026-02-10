"""
Customer Model - Permanent identity for a real person.
One row per human. Deduplicated by phone/email.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead


class Customer(Base):
    """
    Customer model - represents a real person (permanent identity).
    One customer can have many leads (sales opportunities) over time.
    Deduplicated by phone and email.
    """

    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # Contact information (canonical — single source of truth)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True, index=True)
    alternate_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    whatsapp: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Address
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Personal details
    date_of_birth: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    preferred_contact_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    preferred_contact_time: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Tracking
    source_first_touch: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    lifetime_value: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0, server_default="0"
    )

    # Metadata
    meta_data: Mapped[dict] = mapped_column(JSONB, name="meta_data", default=dict, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships (leads where this customer is primary; exclude secondary_customer_id)
    leads: Mapped[List["Lead"]] = relationship(
        "Lead",
        back_populates="customer",
        foreign_keys="Lead.customer_id",
        lazy="noload",
    )

    @property
    def full_name(self) -> str:
        if self.last_name:
            return f"{self.first_name} {self.last_name}"
        return self.first_name

    def __repr__(self) -> str:
        return f"<Customer {self.full_name} ({self.phone or self.email})>"
