"""
FCM Token Model - For Firebase Cloud Messaging (HTTP V1) push notifications
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.user import User


class FCMToken(Base):
    """
    Store FCM device tokens for each user.
    Used with Firebase Cloud Messaging HTTP V1 API.
    A user can have multiple tokens (different devices/browsers).
    """
    __tablename__ = "fcm_tokens"

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
    token: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        unique=True,
        index=True,
        comment="FCM registration token from the client",
    )
    device_name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    user_agent: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    failed_count: Mapped[int] = mapped_column(
        default=0,
        nullable=False,
    )
    last_failed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_success_at: Mapped[Optional[datetime]] = mapped_column(
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
        onupdate=datetime.utcnow,
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", lazy="noload")

    def mark_success(self) -> None:
        self.last_success_at = utc_now()
        self.failed_count = 0

    def mark_failed(self) -> None:
        self.last_failed_at = utc_now()
        self.failed_count += 1
        if self.failed_count >= 5:
            self.is_active = False

    def __repr__(self) -> str:
        return f"<FCMToken user_id={self.user_id} active={self.is_active}>"
