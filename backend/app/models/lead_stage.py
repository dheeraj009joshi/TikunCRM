"""
LeadStage Model - Configurable pipeline stages.
Replaces the hardcoded LeadStatus enum. Per-dealership or global.
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.dealership import Dealership


# Default global stages (used for seeding)
DEFAULT_STAGES = [
    {"name": "new", "display_name": "New", "order": 1, "color": "#3B82F6", "is_terminal": False},
    {"name": "contacted", "display_name": "Contacted", "order": 2, "color": "#F59E0B", "is_terminal": False},
    {"name": "follow_up", "display_name": "Follow Up", "order": 3, "color": "#8B5CF6", "is_terminal": False},
    {"name": "interested", "display_name": "Interested", "order": 4, "color": "#10B981", "is_terminal": False},
    {"name": "in_showroom", "display_name": "In Showroom", "order": 5, "color": "#F97316", "is_terminal": False},
    {"name": "negotiation", "display_name": "Negotiation", "order": 6, "color": "#06B6D4", "is_terminal": False},
    {"name": "browsing", "display_name": "Browsing", "order": 7, "color": "#EAB308", "is_terminal": False},
    {"name": "reschedule", "display_name": "Reschedule", "order": 8, "color": "#A855F7", "is_terminal": False},
    {"name": "converted", "display_name": "Converted", "order": 100, "color": "#059669", "is_terminal": True},
    {"name": "lost", "display_name": "Lost", "order": 101, "color": "#E11D48", "is_terminal": True},
    {"name": "not_interested", "display_name": "Not Interested", "order": 102, "color": "#6B7280", "is_terminal": True},
    {"name": "couldnt_qualify", "display_name": "Couldn't Qualify", "order": 103, "color": "#D97706", "is_terminal": True},
]


class LeadStage(Base):
    """
    Configurable pipeline stage for leads.
    Dealership-specific stages override global ones.
    """

    __tablename__ = "lead_stages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    name: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # NULL = global default; set dealership_id for dealership-specific stages
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    is_terminal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    # Relationships
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership", lazy="noload"
    )

    def __repr__(self) -> str:
        scope = f"dealership={self.dealership_id}" if self.dealership_id else "global"
        return f"<LeadStage {self.display_name} ({scope})>"
