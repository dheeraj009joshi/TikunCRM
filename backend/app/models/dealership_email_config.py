"""
Dealership Email Configuration Model
Stores SMTP and IMAP settings for each dealership
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.encryption import encrypt_value, decrypt_value
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.dealership import Dealership


class DealershipEmailConfig(Base):
    """
    Email configuration for a dealership.
    Stores SMTP settings for sending and IMAP settings for receiving emails.
    Passwords are stored encrypted.
    """
    
    __tablename__ = "dealership_email_configs"
    
    # Primary key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Foreign key to dealership (one-to-one relationship)
    dealership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # One config per dealership
        index=True
    )
    
    # SMTP Settings (for sending emails)
    smtp_host: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="SMTP server hostname (e.g., smtp.hostinger.com)"
    )
    smtp_port: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=465,
        comment="SMTP port (465 for SSL, 587 for TLS)"
    )
    smtp_username: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="SMTP authentication username (usually an email address)"
    )
    _smtp_password: Mapped[str] = mapped_column(
        "smtp_password",
        Text,
        nullable=False,
        comment="Encrypted SMTP password"
    )
    smtp_use_ssl: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Use SSL (port 465) instead of TLS (port 587)"
    )
    smtp_use_tls: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Use STARTTLS (for port 587)"
    )
    
    # IMAP Settings (for receiving emails)
    imap_host: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="IMAP server hostname (e.g., imap.hostinger.com)"
    )
    imap_port: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=993,
        comment="IMAP port (usually 993 for SSL)"
    )
    imap_username: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="IMAP username (usually same as SMTP)"
    )
    _imap_password: Mapped[Optional[str]] = mapped_column(
        "imap_password",
        Text,
        nullable=True,
        comment="Encrypted IMAP password (usually same as SMTP)"
    )
    imap_use_ssl: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Use SSL for IMAP connection"
    )
    
    # Display settings
    from_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Default display name for sent emails (e.g., 'Premium Motors')"
    )
    
    # SendGrid settings (optional - overrides system defaults)
    from_email: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Verified sender email for this dealership (e.g., noreply@abcmotors.com)"
    )
    
    # Status tracking
    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether the configuration has been verified with a test email"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether email sending is enabled for this dealership"
    )
    
    # IMAP sync tracking
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last time IMAP inbox was checked for new emails"
    )
    last_sync_uid: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Last processed IMAP message UID for incremental sync"
    )
    
    # Timestamps
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
    
    # Relationships
    dealership: Mapped["Dealership"] = relationship(
        "Dealership",
        back_populates="email_config",
        lazy="noload"
    )
    
    # Properties for encrypted password handling
    @property
    def smtp_password(self) -> str:
        """Decrypt and return the SMTP password"""
        return decrypt_value(self._smtp_password) if self._smtp_password else ""
    
    @smtp_password.setter
    def smtp_password(self, value: str) -> None:
        """Encrypt and store the SMTP password"""
        self._smtp_password = encrypt_value(value) if value else ""
    
    @property
    def imap_password(self) -> str:
        """Decrypt and return the IMAP password"""
        return decrypt_value(self._imap_password) if self._imap_password else ""
    
    @imap_password.setter
    def imap_password(self, value: str) -> None:
        """Encrypt and store the IMAP password"""
        self._imap_password = encrypt_value(value) if value else ""
    
    def __repr__(self) -> str:
        return f"<DealershipEmailConfig(dealership_id={self.dealership_id}, smtp_host={self.smtp_host})>"
