"""
OAuth Token Model
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.user import User


class OAuthProvider(str, Enum):
    """OAuth provider types"""
    GOOGLE = "google"
    META = "meta"


class OAuthToken(Base):
    """OAuth token storage for external service integrations"""
    
    __tablename__ = "oauth_tokens"
    
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
    
    provider: Mapped[OAuthProvider] = mapped_column(
        SQLEnum(OAuthProvider),
        nullable=False
    )
    
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str] = mapped_column(Text, nullable=True)
    
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Scope of access granted
    scope: Mapped[str] = mapped_column(Text, nullable=True)
    
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
    user: Mapped["User"] = relationship(
        "User",
        back_populates="oauth_tokens",
        lazy="noload"
    )
    
    @property
    def is_expired(self) -> bool:
        """Check if token is expired"""
        if self.expires_at is None:
            return False
        return utc_now() > self.expires_at
    
    def __repr__(self) -> str:
        return f"<OAuthToken {self.provider.value} for User {self.user_id}>"
