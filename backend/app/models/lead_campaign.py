"""
LeadCampaign Model - Junction table for tracking multiple campaigns per lead.
When a lead appears in multiple campaigns (sync sources), each association is tracked here.
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.campaign_mapping import CampaignMapping
    from app.models.lead_sync_source import LeadSyncSource


class LeadCampaign(Base):
    """
    Junction table tracking which campaigns a lead has appeared in.
    Allows a single lead to be associated with multiple campaigns/sync sources.
    """

    __tablename__ = "lead_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    
    # Link to the lead
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    # Campaign info - at least one should be set
    campaign_mapping_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("campaign_mappings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Campaign mapping that matched this lead (if any)"
    )
    campaign_name: Mapped[str] = mapped_column(
        String(255), nullable=False,
        comment="Raw campaign name from the sync source"
    )
    
    # Source tracking
    sync_source_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lead_sync_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Sync source this campaign entry came from"
    )
    
    # Timestamp
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False,
        comment="When this campaign association was added"
    )

    # Relationships
    lead: Mapped["Lead"] = relationship(
        "Lead", back_populates="campaigns"
    )
    campaign_mapping: Mapped[Optional["CampaignMapping"]] = relationship(
        "CampaignMapping", lazy="selectin"
    )
    sync_source: Mapped[Optional["LeadSyncSource"]] = relationship(
        "LeadSyncSource", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<LeadCampaign lead_id={self.lead_id} campaign={self.campaign_name}>"
