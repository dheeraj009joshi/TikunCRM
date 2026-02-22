"""
Lead Sync Source Model - Configurable lead sync sources (Google Sheets, etc.)
Super Admin only - manages which sheets sync to which dealerships.
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, ENUM as PgENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.dealership import Dealership
    from app.models.user import User
    from app.models.campaign_mapping import CampaignMapping


class SyncSourceType(str, Enum):
    """Type of sync source"""
    GOOGLE_SHEETS = "google_sheets"
    CSV_UPLOAD = "csv_upload"
    API = "api"


class LeadSyncSource(Base):
    """
    Configurable lead sync sources (Google Sheets, etc.)
    Super Admin only - manages which sheets sync to which dealerships.
    """
    __tablename__ = "lead_sync_sources"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Source identification
    name: Mapped[str] = mapped_column(
        String(100), nullable=False,
        comment="Internal name for identification"
    )
    display_name: Mapped[str] = mapped_column(
        String(150), nullable=False,
        comment="Display name shown in UI"
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Optional description of this sync source"
    )

    # Source type and configuration
    source_type: Mapped[str] = mapped_column(
        PgENUM('google_sheets', 'csv_upload', 'api', name='syncsourcetype', create_type=False),
        nullable=False,
        default='google_sheets'
    )

    # Google Sheet configuration
    sheet_id: Mapped[str] = mapped_column(
        String(100), nullable=False,
        comment="Google Sheet ID (from URL)"
    )
    sheet_gid: Mapped[str] = mapped_column(
        String(20), nullable=False, default="0",
        comment="Sheet tab GID (0 for first tab)"
    )

    # Default dealership for all leads from this sheet
    # If null, leads go to global pool
    default_dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Default dealership for leads (can be overridden by campaign mapping)"
    )

    # Default display name when campaign doesn't match any mapping
    default_campaign_display: Mapped[Optional[str]] = mapped_column(
        String(150), nullable=True,
        comment="Display name when no campaign mapping matches"
    )

    # Sync settings
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False,
        comment="Whether this source is actively syncing"
    )
    sync_interval_minutes: Mapped[int] = mapped_column(
        Integer, default=5, nullable=False,
        comment="How often to sync (in minutes)"
    )
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
        comment="Last successful sync timestamp"
    )
    last_sync_lead_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False,
        comment="Number of leads synced in last run"
    )
    total_leads_synced: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False,
        comment="Total leads ever synced from this source"
    )
    last_sync_error: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Last sync error message (if any)"
    )

    # Audit - track who created/modified (Super Admin)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=True
    )

    # Relationships
    default_dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        foreign_keys=[default_dealership_id],
        lazy="selectin"
    )
    creator: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[created_by],
        lazy="selectin"
    )
    campaign_mappings: Mapped[List["CampaignMapping"]] = relationship(
        "CampaignMapping",
        back_populates="sync_source",
        lazy="selectin",
        cascade="all, delete-orphan"
    )

    @property
    def sheet_url(self) -> str:
        """Generate the full Google Sheets URL"""
        return f"https://docs.google.com/spreadsheets/d/{self.sheet_id}/edit#gid={self.sheet_gid}"

    @property
    def export_url(self) -> str:
        """Generate the CSV export URL"""
        return f"https://docs.google.com/spreadsheets/d/{self.sheet_id}/export?format=csv&gid={self.sheet_gid}"

    def __repr__(self) -> str:
        return f"<LeadSyncSource {self.name} sheet={self.sheet_id} active={self.is_active}>"
