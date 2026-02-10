"""
StipsCategory Model - Admin-configured document categories (e.g. Personal, Finance).
Scope: customer = documents follow the customer across leads; lead = documents belong to one lead.
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.dealership import Dealership


class StipsCategory(Base):
    """Configurable category for Stips documents (Personal, Finance, etc.)."""

    __tablename__ = "stips_categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # "customer" = docs follow customer; "lead" = docs belong to lead only
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default="lead")
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    dealership: Mapped[Optional["Dealership"]] = relationship("Dealership", lazy="noload")
