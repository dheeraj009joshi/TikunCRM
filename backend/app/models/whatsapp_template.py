"""
WhatsApp Template Model - Pre-approved WhatsApp Content templates (Content SID + variables).
Templates are created and approved in Twilio Content Template Builder; this table stores
metadata for the app UI (picker + variable inputs).
"""
import uuid
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.dealership import Dealership


class WhatsAppTemplate(Base):
    """
    Metadata for a WhatsApp Content Template (Content SID from Twilio).
    variable_names: list of placeholder keys e.g. ["1", "2"] for {{1}}, {{2}}.
    """
    __tablename__ = "whatsapp_templates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    content_sid: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    variable_names: Mapped[List[str]] = mapped_column(
        JSONB,
        default=list,
        nullable=False,
    )  # e.g. ["1", "2"]
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    dealership: Mapped[Optional["Dealership"]] = relationship("Dealership", lazy="noload")

    def __repr__(self) -> str:
        return f"<WhatsAppTemplate {self.name} {self.content_sid}>"
