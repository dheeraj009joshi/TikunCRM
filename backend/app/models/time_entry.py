"""
Time Entry Model — BDC agent clock-in / clock-out punches.
CRM login is independent of being on the clock.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timezone import utc_now
from app.db.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class TimeEntry(Base):
    """A single work session (clock-in to clock-out). Open when clock_out_at is null."""

    __tablename__ = "time_entries"
    __table_args__ = (
        Index(
            "uq_time_entries_one_open_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("clock_out_at IS NULL"),
        ),
        Index("ix_time_entries_user_clock_in", "user_id", "clock_in_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    clock_in_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
    clock_out_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # Rate in effect when the session started so past payouts stay stable if the rate changes
    hourly_rate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2),
        nullable=True,
    )
    overtime_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(4, 2),
        nullable=False,
        default=Decimal("1.50"),
        server_default="1.50",
    )
    clock_in_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="web", server_default="web")
    edited_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    edit_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    over_cap_approved: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="When true, hours over the agent's daily/weekly cap are paid",
    )
    over_cap_approved_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    over_cap_approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[user_id],
        lazy="noload",
    )
    edited_by: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[edited_by_id],
        lazy="noload",
    )
    over_cap_approved_by: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[over_cap_approved_by_id],
        lazy="noload",
    )
