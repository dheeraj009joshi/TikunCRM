"""
User Dealership Access — BDC multi-dealership scope
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timezone import utc_now
from app.db.database import Base

if TYPE_CHECKING:
    from app.models.dealership import Dealership
    from app.models.user import User


class UserDealershipAccess(Base):
    """Maps BDC users to dealerships they can access."""

    __tablename__ = "user_dealership_access"
    __table_args__ = (
        UniqueConstraint("user_id", "dealership_id", name="uq_user_dealership_access"),
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
    dealership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assigned_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[user_id],
        back_populates="dealership_access",
        lazy="noload",
    )
    dealership: Mapped["Dealership"] = relationship(
        "Dealership",
        lazy="noload",
    )
