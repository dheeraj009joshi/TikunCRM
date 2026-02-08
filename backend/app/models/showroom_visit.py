"""
Showroom Visit Model - For tracking customer check-in/check-out at dealership
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Text, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.user import User
    from app.models.dealership import Dealership
    from app.models.appointment import Appointment


class ShowroomOutcome(str, Enum):
    """Outcome of a showroom visit"""
    SOLD = "sold"
    NOT_INTERESTED = "not_interested"
    FOLLOW_UP = "follow_up"
    RESCHEDULE = "reschedule"
    BROWSING = "browsing"  # Just looking, may return
    COULDNT_QUALIFY = "couldnt_qualify"


class ShowroomVisit(Base):
    """
    Showroom Visit model for tracking customer check-in/check-out.
    Tracks who is currently in the showroom and the outcome of their visit.
    """
    
    __tablename__ = "showroom_visits"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Associated lead (required)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # Associated appointment (if customer came for an appointment)
    appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True
    )
    
    # Dealership where the visit occurred
    dealership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # Check-in/out tracking
    checked_in_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    checked_out_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Who performed check-in/out
    checked_in_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False
    )
    checked_out_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    
    # Outcome (set on check-out)
    outcome: Mapped[Optional[ShowroomOutcome]] = mapped_column(
        SQLEnum(ShowroomOutcome),
        nullable=True
    )
    
    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
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
    lead: Mapped["Lead"] = relationship(
        "Lead",
        foreign_keys=[lead_id],
        lazy="noload"
    )
    appointment: Mapped[Optional["Appointment"]] = relationship(
        "Appointment",
        foreign_keys=[appointment_id],
        lazy="noload"
    )
    dealership: Mapped["Dealership"] = relationship(
        "Dealership",
        foreign_keys=[dealership_id],
        lazy="noload"
    )
    checked_in_by_user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[checked_in_by],
        lazy="noload"
    )
    checked_out_by_user: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[checked_out_by],
        lazy="noload"
    )
    
    @property
    def is_checked_in(self) -> bool:
        """Check if customer is currently in showroom"""
        return self.checked_out_at is None
    
    def __repr__(self):
        return f"<ShowroomVisit {self.id} lead={self.lead_id} in={self.is_checked_in}>"
