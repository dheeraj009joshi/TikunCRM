"""
Password Reset Token Model
"""
import uuid
import secrets
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.user import User


class PasswordResetToken(Base):
    """Password reset token for forgot password flow"""
    
    __tablename__ = "password_reset_tokens"
    
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
    
    # Token is stored hashed for security
    token_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True
    )
    
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )
    
    used: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False
    )
    
    used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    
    # Relationship
    user: Mapped["User"] = relationship("User", lazy="noload")
    
    @classmethod
    def generate_token(cls) -> str:
        """Generate a secure random token"""
        return secrets.token_urlsafe(32)
    
    @classmethod
    def hash_token(cls, token: str) -> str:
        """Hash the token for storage"""
        import hashlib
        return hashlib.sha256(token.encode()).hexdigest()
    
    @classmethod
    def create_for_user(cls, user_id: uuid.UUID, expire_hours: int = 24) -> tuple["PasswordResetToken", str]:
        """
        Create a new password reset token for a user.
        Returns (token_model, raw_token) - raw_token is what gets sent to user
        """
        raw_token = cls.generate_token()
        token_hash = cls.hash_token(raw_token)
        
        token = cls(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=utc_now() + timedelta(hours=expire_hours)
        )
        
        return token, raw_token
    
    def is_valid(self) -> bool:
        """Check if token is valid (not used and not expired)"""
        return not self.used and utc_now() < self.expires_at
    
    def mark_used(self) -> None:
        """Mark token as used"""
        self.used = True
        self.used_at = utc_now()
    
    def __repr__(self) -> str:
        return f"<PasswordResetToken user_id={self.user_id} used={self.used}>"
