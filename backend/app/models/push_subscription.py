"""
Push Subscription Model - For Web Push Notifications
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class PushSubscription(Base):
    """
    Store web push subscriptions for each user/device.
    A user can have multiple subscriptions (different devices/browsers).
    """
    
    __tablename__ = "push_subscriptions"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # The push subscription endpoint (unique per device/browser)
    endpoint: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        unique=True,
        index=True
    )
    
    # Keys from the push subscription
    p256dh_key: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        comment="Public key for encryption"
    )
    auth_key: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        comment="Auth secret for encryption"
    )
    
    # Full subscription JSON for backup/debugging
    subscription_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict
    )
    
    # Device info for display
    user_agent: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="Browser/device info"
    )
    device_name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="User-friendly device name"
    )
    
    # Subscription status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False
    )
    
    # Track delivery issues
    failed_count: Mapped[int] = mapped_column(
        default=0,
        nullable=False,
        comment="Number of failed push attempts"
    )
    last_failed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    last_success_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )
    
    # Relationship
    user: Mapped["User"] = relationship("User", lazy="noload")
    
    def get_subscription_info(self) -> dict:
        """Get subscription info for pywebpush"""
        return {
            "endpoint": self.endpoint,
            "keys": {
                "p256dh": self.p256dh_key,
                "auth": self.auth_key
            }
        }
    
    def mark_success(self):
        """Mark a successful push delivery"""
        self.last_success_at = datetime.utcnow()
        self.failed_count = 0
    
    def mark_failed(self):
        """Mark a failed push delivery"""
        self.last_failed_at = datetime.utcnow()
        self.failed_count += 1
        
        # Deactivate if too many failures
        if self.failed_count >= 5:
            self.is_active = False
    
    def __repr__(self) -> str:
        return f"<PushSubscription user_id={self.user_id} active={self.is_active}>"
