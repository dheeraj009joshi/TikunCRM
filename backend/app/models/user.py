"""
User Model
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.permissions import UserRole
from app.core.timezone import utc_now
from app.db.database import Base

if TYPE_CHECKING:
    from app.models.dealership import Dealership
    from app.models.lead import Lead
    from app.models.activity import Activity
    from app.models.schedule import Schedule
    from app.models.follow_up import FollowUp
    from app.models.oauth_token import OAuthToken
    from app.models.call_log import CallLog


class User(Base):
    """User model - represents all system users across roles"""
    
    __tablename__ = "users"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    avatar_url: Mapped[str] = mapped_column(String(500), nullable=True)
    
    # ===== User's Personal Email Configuration (Hostinger/SMTP) =====
    # Each user configures their own email credentials
    smtp_email: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="User's email address for sending (e.g., john@dealership.com)"
    )
    smtp_host: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        default="smtp.hostinger.com",
        comment="SMTP server host"
    )
    smtp_port: Mapped[int] = mapped_column(
        default=465,
        nullable=False,
        comment="SMTP port (465 for SSL, 587 for TLS)"
    )
    smtp_password_encrypted: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="Encrypted SMTP password"
    )
    smtp_use_ssl: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Use SSL for SMTP connection"
    )
    email_config_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Whether email config has been tested successfully"
    )
    
    # ===== IMAP Configuration (for receiving replies) =====
    imap_host: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        default="imap.hostinger.com",
        comment="IMAP server host"
    )
    imap_port: Mapped[int] = mapped_column(
        default=993,
        nullable=False,
        comment="IMAP port (993 for SSL)"
    )
    imap_password_encrypted: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="Encrypted IMAP password (usually same as SMTP)"
    )
    imap_use_ssl: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Use SSL for IMAP connection"
    )
    imap_last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last time IMAP inbox was synced"
    )
    
    # Legacy field - keeping for backward compatibility
    dealership_email: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Deprecated: Use smtp_email instead"
    )
    
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole),
        nullable=False,
        default=UserRole.SALESPERSON
    )
    
    # Dealership association (null for super admins)
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    # Password management
    must_change_password: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Force user to change password on next login"
    )
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last time password was changed"
    )
    
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
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
    
    # Relationships - use lazy="noload" to avoid N+1 queries, load explicitly when needed
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        back_populates="users",
        lazy="noload"
    )
    assigned_leads: Mapped[List["Lead"]] = relationship(
        "Lead",
        back_populates="assigned_to_user",
        foreign_keys="Lead.assigned_to",
        lazy="noload"
    )
    created_leads: Mapped[List["Lead"]] = relationship(
        "Lead",
        back_populates="created_by_user",
        foreign_keys="Lead.created_by",
        lazy="noload"
    )
    activities: Mapped[List["Activity"]] = relationship(
        "Activity",
        back_populates="user",
        lazy="noload"
    )
    schedules: Mapped[List["Schedule"]] = relationship(
        "Schedule",
        back_populates="user",
        lazy="noload"
    )
    follow_ups: Mapped[List["FollowUp"]] = relationship(
        "FollowUp",
        back_populates="assigned_to_user",
        lazy="noload"
    )
    oauth_tokens: Mapped[List["OAuthToken"]] = relationship(
        "OAuthToken",
        back_populates="user",
        lazy="noload"
    )
    call_logs: Mapped[List["CallLog"]] = relationship(
        "CallLog",
        back_populates="user",
        lazy="noload"
    )
    
    @property
    def full_name(self) -> str:
        """Get user's full name"""
        return f"{self.first_name} {self.last_name}"
    
    def __repr__(self) -> str:
        return f"<User {self.email} ({self.role.value})>"
