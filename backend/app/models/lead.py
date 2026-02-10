"""
Lead Model - Represents ONE sales opportunity / cycle.
A customer can have many leads over time.
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.lead_stage import LeadStage
    from app.models.dealership import Dealership
    from app.models.user import User
    from app.models.activity import Activity
    from app.models.follow_up import FollowUp
    from app.models.email_log import EmailLog
    from app.models.appointment import Appointment
    from app.models.call_log import CallLog
    from app.models.sms_log import SMSLog
    from app.models.whatsapp_log import WhatsAppLog


class LeadSource(str, Enum):
    """Lead acquisition sources"""
    GOOGLE_SHEETS = "google_sheets"
    META_ADS = "meta_ads"
    MANUAL = "manual"
    WEBSITE = "website"
    REFERRAL = "referral"
    WALK_IN = "walk_in"


class Lead(Base):
    """
    Lead model — represents one sales opportunity.
    Contact info lives on the related Customer.
    Pipeline position is determined by the related LeadStage.
    """

    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # --- Customer link (permanent person) ---
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    secondary_customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- Pipeline stage (replaces old LeadStatus enum) ---
    stage_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lead_stages.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # --- Lead details ---
    source: Mapped[LeadSource] = mapped_column(
        SQLEnum(LeadSource), nullable=False, default=LeadSource.MANUAL
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, index=True
    )
    outcome: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # "converted", "lost", or NULL while active
    interest_score: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # --- Assignment ---
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    secondary_salesperson_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --- Additional lead-specific info ---
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    meta_data: Mapped[dict] = mapped_column(
        JSONB, name="meta_data", default=dict, nullable=False
    )
    external_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True
    )
    interested_in: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    budget_range: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # --- Timestamps ---
    first_contacted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_contacted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_activity_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
        comment="Last activity timestamp for auto-assignment tracking",
    )
    converted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=False
    )

    # ── Relationships ──────────────────────────────────────────────
    customer: Mapped["Customer"] = relationship(
        "Customer", back_populates="leads", foreign_keys=[customer_id], lazy="selectin"
    )
    secondary_customer: Mapped[Optional["Customer"]] = relationship(
        "Customer", foreign_keys=[secondary_customer_id], lazy="selectin"
    )
    stage: Mapped["LeadStage"] = relationship("LeadStage", lazy="selectin")

    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership", back_populates="leads", foreign_keys=[dealership_id], lazy="noload"
    )
    assigned_to_user: Mapped[Optional["User"]] = relationship(
        "User", back_populates="assigned_leads", foreign_keys=[assigned_to], lazy="noload"
    )
    secondary_salesperson: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[secondary_salesperson_id], lazy="noload"
    )
    created_by_user: Mapped[Optional["User"]] = relationship(
        "User", back_populates="created_leads", foreign_keys=[created_by], lazy="noload"
    )
    activities: Mapped[List["Activity"]] = relationship(
        "Activity", back_populates="lead", lazy="noload",
        order_by="desc(Activity.created_at)",
    )
    follow_ups: Mapped[List["FollowUp"]] = relationship(
        "FollowUp", back_populates="lead", lazy="noload"
    )
    email_logs: Mapped[List["EmailLog"]] = relationship(
        "EmailLog", back_populates="lead", lazy="noload"
    )
    appointments: Mapped[List["Appointment"]] = relationship(
        "Appointment", back_populates="lead", lazy="noload"
    )
    call_logs: Mapped[List["CallLog"]] = relationship(
        "CallLog", back_populates="lead", lazy="noload"
    )
    sms_logs: Mapped[List["SMSLog"]] = relationship(
        "SMSLog", back_populates="lead", lazy="noload"
    )
    whatsapp_logs: Mapped[List["WhatsAppLog"]] = relationship(
        "WhatsAppLog", back_populates="lead", lazy="noload"
    )

    # ── Backward-compat proxy properties (contact info lives on Customer) ──
    @property
    def first_name(self) -> str:
        return self.customer.first_name if self.customer else ""

    @property
    def last_name(self) -> Optional[str]:
        return self.customer.last_name if self.customer else None

    @property
    def phone(self) -> Optional[str]:
        return self.customer.phone if self.customer else None

    @property
    def email(self) -> Optional[str]:
        return self.customer.email if self.customer else None

    @property
    def alternate_phone(self) -> Optional[str]:
        return self.customer.alternate_phone if self.customer else None

    @property
    def full_name(self) -> str:
        if self.customer:
            return self.customer.full_name
        return "Unknown"

    @property
    def address(self) -> Optional[str]:
        return self.customer.address if self.customer else None

    @property
    def city(self) -> Optional[str]:
        return self.customer.city if self.customer else None

    @property
    def state(self) -> Optional[str]:
        return self.customer.state if self.customer else None

    @property
    def postal_code(self) -> Optional[str]:
        return self.customer.postal_code if self.customer else None

    @property
    def country(self) -> Optional[str]:
        return self.customer.country if self.customer else None

    @property
    def company(self) -> Optional[str]:
        return self.customer.company if self.customer else None

    @property
    def job_title(self) -> Optional[str]:
        return self.customer.job_title if self.customer else None

    @property
    def date_of_birth(self):
        return self.customer.date_of_birth if self.customer else None

    @property
    def preferred_contact_method(self) -> Optional[str]:
        return self.customer.preferred_contact_method if self.customer else None

    @property
    def preferred_contact_time(self) -> Optional[str]:
        return self.customer.preferred_contact_time if self.customer else None

    def __repr__(self) -> str:
        stage_name = self.stage.display_name if self.stage else "?"
        return f"<Lead {self.id} stage={stage_name} active={self.is_active}>"
