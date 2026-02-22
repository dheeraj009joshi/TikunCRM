"""
Campaign Mapping Model - Maps raw campaign names to display names and dealerships.
Super Admin creates mappings, Dealership Admin/Owner can edit display names.
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, ENUM as PgENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead_sync_source import LeadSyncSource
    from app.models.dealership import Dealership
    from app.models.user import User


class MatchType(str, Enum):
    """How to match the campaign pattern"""
    EXACT = "exact"
    CONTAINS = "contains"
    STARTS_WITH = "starts_with"
    ENDS_WITH = "ends_with"
    REGEX = "regex"


class CampaignMapping(Base):
    """
    Maps raw campaign names from sheets to display names and dealerships.
    - Super Admin creates mappings with pattern, display name, and dealership
    - Dealership Admin/Owner can edit only the display_name for their dealership
    """
    __tablename__ = "campaign_mappings"

    __table_args__ = (
        UniqueConstraint('sync_source_id', 'match_pattern', name='uq_campaign_mapping_source_pattern'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Link to sync source
    sync_source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lead_sync_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Pattern matching
    match_pattern: Mapped[str] = mapped_column(
        String(255), nullable=False,
        comment="Raw campaign name pattern to match (e.g., 'Toyota |Updated')"
    )
    match_type: Mapped[str] = mapped_column(
        PgENUM('exact', 'contains', 'starts_with', 'ends_with', 'regex', name='matchtype', create_type=False),
        nullable=False,
        default='contains',
        comment="How to match: contains, exact, starts_with, ends_with"
    )

    # Display name (editable by Dealership Admin/Owner)
    display_name: Mapped[str] = mapped_column(
        String(255), nullable=False,
        comment="Display name shown in frontend (editable by dealership admin)"
    )

    # Dealership assignment (override sync source default)
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Dealership for leads matching this campaign (overrides sync source default)"
    )

    # Priority for matching (lower = higher priority)
    priority: Mapped[int] = mapped_column(
        Integer, default=100, nullable=False,
        comment="Priority for pattern matching (lower = higher priority)"
    )

    # Whether this mapping is active
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )

    # Statistics
    leads_matched: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False,
        comment="Number of leads matched by this mapping"
    )

    # Audit trail
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="Super Admin who created this mapping"
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="Last user who updated (could be dealership admin for display name)"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=True
    )

    # Relationships
    sync_source: Mapped["LeadSyncSource"] = relationship(
        "LeadSyncSource",
        back_populates="campaign_mappings",
        lazy="selectin"
    )
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        foreign_keys=[dealership_id],
        lazy="selectin"
    )
    creator: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[created_by],
        lazy="selectin"
    )
    updater: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[updated_by],
        lazy="selectin"
    )

    def matches(self, campaign_name: str) -> bool:
        """Check if a campaign name matches this mapping's pattern"""
        if not campaign_name:
            return False
        
        campaign_lower = campaign_name.lower()
        pattern_lower = self.match_pattern.lower()
        
        if self.match_type == 'exact':
            return campaign_lower == pattern_lower
        elif self.match_type == 'starts_with':
            return campaign_lower.startswith(pattern_lower)
        elif self.match_type == 'ends_with':
            return campaign_lower.endswith(pattern_lower)
        elif self.match_type == 'regex':
            import re
            try:
                return bool(re.search(self.match_pattern, campaign_name, re.IGNORECASE))
            except re.error:
                return False
        else:  # 'contains' (default)
            return pattern_lower in campaign_lower

    def __repr__(self) -> str:
        return f"<CampaignMapping '{self.match_pattern}' -> '{self.display_name}'>"
