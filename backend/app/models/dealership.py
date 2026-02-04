"""
Dealership Model
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.lead import Lead
    from app.models.dealership_email_config import DealershipEmailConfig


class Dealership(Base):
    """Dealership entity - represents an independent operational unit"""
    
    __tablename__ = "dealerships"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=True, unique=True, index=True)  # URL-safe identifier for email routing
    address: Mapped[str] = mapped_column(Text, nullable=True)
    city: Mapped[str] = mapped_column(String(100), nullable=True)
    state: Mapped[str] = mapped_column(String(100), nullable=True)
    country: Mapped[str] = mapped_column(String(100), nullable=True)
    postal_code: Mapped[str] = mapped_column(String(20), nullable=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=True)
    website: Mapped[str] = mapped_column(String(255), nullable=True)
    
    # Configuration stored as JSON
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    
    # Working hours stored as JSON
    # Format: {"monday": {"start": "09:00", "end": "18:00", "is_open": true}, ...}
    working_hours: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    
    # Lead assignment rules
    # Format: {"auto_assign": true, "round_robin": true, "max_leads_per_salesperson": 50}
    lead_assignment_rules: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    
    # Timezone for this dealership (e.g., "America/New_York", "Europe/London", "Asia/Kolkata")
    timezone: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="UTC",
        comment="Timezone for this dealership (IANA timezone name)"
    )
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    
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
    
    # Relationships - use lazy="noload" to avoid N+1 queries
    users: Mapped[List["User"]] = relationship(
        "User",
        back_populates="dealership",
        lazy="noload"
    )
    leads: Mapped[List["Lead"]] = relationship(
        "Lead",
        back_populates="dealership",
        foreign_keys="Lead.dealership_id",
        lazy="noload"
    )
    
    # One-to-one relationship with email configuration
    email_config: Mapped["DealershipEmailConfig"] = relationship(
        "DealershipEmailConfig",
        back_populates="dealership",
        uselist=False,
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        return f"<Dealership {self.name}>"
