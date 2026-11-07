"""Opt-in program for a partner store: leads only, or full BDC."""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timezone import utc_now
from app.db.database import Base

PROGRAM_LEADS_ONLY = "leads_only"
PROGRAM_FULL_BDC = "full_bdc"
PROGRAM_TYPES = frozenset({PROGRAM_LEADS_ONLY, PROGRAM_FULL_BDC})

PROGRAM_PENDING = "pending"
PROGRAM_ACTIVE = "active"
PROGRAM_PAUSED = "paused"
PROGRAM_CANCELLED = "cancelled"
PROGRAM_STATUSES = frozenset({
    PROGRAM_PENDING,
    PROGRAM_ACTIVE,
    PROGRAM_PAUSED,
    PROGRAM_CANCELLED,
})


class PartnerProgram(Base):
    """One opt-in program per partner store."""

    __tablename__ = "partner_programs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    partner_store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_stores.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    program_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=PROGRAM_PENDING, index=True
    )
    states: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    postal_codes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    min_credit_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_credit_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    min_down_payment: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    daily_cap: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    monthly_cap: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hours: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    timezone: Mapped[str] = mapped_column(
        String(100), nullable=False, default="America/New_York"
    )
    priority_weight: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=False
    )
