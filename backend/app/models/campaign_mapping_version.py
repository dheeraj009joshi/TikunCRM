"""
A saved display name and targeting message for a campaign mapping.

New leads use the latest version. Leads keep the version they were matched
with until someone applies a different version to past leads.
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timezone import utc_now
from app.db.database import Base

if TYPE_CHECKING:
    from app.models.campaign_mapping import CampaignMapping
    from app.models.user import User


class CampaignMappingVersion(Base):
    __tablename__ = "campaign_mapping_versions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    campaign_mapping_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("campaign_mappings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    targeting_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    campaign_mapping: Mapped["CampaignMapping"] = relationship(
        "CampaignMapping",
        back_populates="versions",
    )
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
