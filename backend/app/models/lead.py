"""
Lead Model
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.dealership import Dealership
    from app.models.user import User
    from app.models.activity import Activity
    from app.models.follow_up import FollowUp
    from app.models.email_log import EmailLog


class LeadSource(str, Enum):
    """Lead acquisition sources"""
    GOOGLE_SHEETS = "google_sheets"
    META_ADS = "meta_ads"
    MANUAL = "manual"
    WEBSITE = "website"
    REFERRAL = "referral"
    WALK_IN = "walk_in"


class LeadStatus(str, Enum):
    """Lead lifecycle statuses"""
    NEW = "new"
    CONTACTED = "contacted"
    FOLLOW_UP = "follow_up"
    INTERESTED = "interested"
    NOT_INTERESTED = "not_interested"
    CONVERTED = "converted"
    LOST = "lost"


class Lead(Base):
    """Lead model - represents a potential customer"""
    
    __tablename__ = "leads"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Contact information
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=True, index=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=True, index=True)
    alternate_phone: Mapped[str] = mapped_column(String(20), nullable=True)
    
    # Lead details
    source: Mapped[LeadSource] = mapped_column(
        SQLEnum(LeadSource),
        nullable=False,
        default=LeadSource.MANUAL
    )
    status: Mapped[LeadStatus] = mapped_column(
        SQLEnum(LeadStatus),
        nullable=False,
        default=LeadStatus.NEW,
        index=True
    )
    
    # Assignment
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    
    # Additional info
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    
    # Metadata for source-specific data (e.g., Meta Lead Form fields)
    meta_data: Mapped[dict] = mapped_column(JSONB, name="meta_data", default=dict, nullable=False)
    
    # External IDs for deduplication
    external_id: Mapped[str] = mapped_column(String(255), nullable=True, index=True)
    
    # Interest tracking
    interested_in: Mapped[str] = mapped_column(String(255), nullable=True)
    budget_range: Mapped[str] = mapped_column(String(100), nullable=True)
    
    # Timestamps
    first_contacted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    last_contacted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    converted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )
    
    # Relationships - use lazy="noload" to avoid N+1 queries, load explicitly when needed
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        back_populates="leads",
        foreign_keys=[dealership_id],
        lazy="noload"
    )
    assigned_to_user: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="assigned_leads",
        foreign_keys=[assigned_to],
        lazy="noload"
    )
    created_by_user: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="created_leads",
        foreign_keys=[created_by],
        lazy="noload"
    )
    activities: Mapped[List["Activity"]] = relationship(
        "Activity",
        back_populates="lead",
        lazy="noload",
        order_by="desc(Activity.created_at)"
    )
    follow_ups: Mapped[List["FollowUp"]] = relationship(
        "FollowUp",
        back_populates="lead",
        lazy="noload"
    )
    email_logs: Mapped[List["EmailLog"]] = relationship(
        "EmailLog",
        back_populates="lead",
        lazy="noload"
    )
    
    @property
    def full_name(self) -> str:
        """Get lead's full name"""
        if self.last_name:
            return f"{self.first_name} {self.last_name}"
        return self.first_name
    
    def __repr__(self) -> str:
        return f"<Lead {self.full_name} ({self.status.value})>"
