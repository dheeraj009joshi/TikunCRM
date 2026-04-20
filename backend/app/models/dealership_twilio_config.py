"""
Per-dealership Twilio configuration (SMS, WhatsApp, Voice).
Secrets stored encrypted; one row per dealership.
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.encryption import encrypt_value, decrypt_value
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.dealership import Dealership
    from app.models.user import User


class DealershipTwilioConfig(Base):
    """Twilio credentials and channel toggles for a dealership."""

    __tablename__ = "dealership_twilio_configs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    dealership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    account_sid: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    _auth_token: Mapped[Optional[str]] = mapped_column(
        "auth_token",
        Text,
        nullable=True,
        comment="Encrypted Twilio auth token",
    )

    sms_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sms_from_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    whatsapp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    whatsapp_from_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    voice_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    twilio_twiml_app_sid: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    twilio_api_key_sid: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    _twilio_api_key_secret: Mapped[Optional[str]] = mapped_column(
        "twilio_api_key_secret",
        Text,
        nullable=True,
        comment="Encrypted API Key Secret for WebRTC tokens",
    )
    voice_caller_id_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    
    # AI Outbound Calling
    ai_outbound_enabled: Mapped[bool] = mapped_column(
        Boolean, 
        nullable=False, 
        default=False,
        comment="Enable AI outbound calling for new leads"
    )

    updated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
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

    dealership: Mapped["Dealership"] = relationship(
        "Dealership",
        back_populates="twilio_config",
        lazy="noload",
    )

    @property
    def auth_token(self) -> str:
        return decrypt_value(self._auth_token) if self._auth_token else ""

    @auth_token.setter
    def auth_token(self, value: str) -> None:
        self._auth_token = encrypt_value(value) if value else None

    @property
    def twilio_api_key_secret(self) -> str:
        return (
            decrypt_value(self._twilio_api_key_secret)
            if self._twilio_api_key_secret
            else ""
        )

    @twilio_api_key_secret.setter
    def twilio_api_key_secret(self, value: str) -> None:
        self._twilio_api_key_secret = encrypt_value(value) if value else None

    def __repr__(self) -> str:
        return f"<DealershipTwilioConfig dealership_id={self.dealership_id}>"
