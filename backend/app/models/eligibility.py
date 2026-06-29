"""
Eligibility (Trust) Score engine models.

A dealership defines dynamic, weighted `EligibilityCriterion` rows. Any entity
(lead, customer, guest) gets one `EligibilityAssessment` whose
`EligibilityAssessmentItem` rows record which criteria are met. The score is a
normalized 0-100 number recomputed whenever items or criteria change.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.user import User


class EligibilityInputType(str, Enum):
    """How a criterion is captured / rendered in the UI."""
    BOOLEAN = "boolean"   # Yes/No checkbox
    NUMBER = "number"     # Numeric value scored by threshold or scaling
    SELECT = "select"     # Dropdown where each option carries a weight fraction


class EligibilityValueSource(str, Enum):
    """Where the criterion value comes from."""
    MANUAL = "manual"     # A rep ticks / fills it
    AUTO = "auto"         # Computed from entity data (override still allowed)


class EligibilityEntityType(str, Enum):
    """Entities that can be scored by the engine."""
    LEAD = "lead"
    CUSTOMER = "customer"
    GUEST = "guest"


class EligibilityCriterion(Base):
    """A dynamic, dealership-configurable scoring criterion."""

    __tablename__ = "eligibility_criteria"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    key: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="General", server_default="General")

    # Max points this criterion can contribute to the raw total.
    weight: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0, server_default="0")

    input_type: Mapped[str] = mapped_column(String(20), nullable=False, default=EligibilityInputType.BOOLEAN.value)
    value_source: Mapped[str] = mapped_column(String(20), nullable=False, default=EligibilityValueSource.MANUAL.value)
    # Resolver key when value_source == auto (e.g. down_payment, credit_score, has_license, distance_miles)
    auto_field: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Type-specific configuration (threshold/scaled settings, select options, etc.)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return f"<EligibilityCriterion {self.label} weight={self.weight} type={self.input_type}>"


class EligibilityAssessment(Base):
    """One scoring record per entity (lead/customer/guest)."""

    __tablename__ = "eligibility_assessment"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", name="uq_eligibility_assessment_entity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    entity_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    total_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0, server_default="0")
    raw_points: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0, server_default="0")
    max_points: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0, server_default="0")

    last_updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=datetime.utcnow, nullable=False
    )

    items: Mapped[List["EligibilityAssessmentItem"]] = relationship(
        "EligibilityAssessmentItem",
        back_populates="assessment",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<EligibilityAssessment {self.entity_type}:{self.entity_id} score={self.total_score}>"


class EligibilityAssessmentItem(Base):
    """Per-criterion state within an assessment."""

    __tablename__ = "eligibility_assessment_item"
    __table_args__ = (
        UniqueConstraint("assessment_id", "criterion_id", name="uq_eligibility_item_assessment_criterion"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("eligibility_assessment.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    criterion_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("eligibility_criteria.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    is_met: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Stored value for number / select criteria (e.g. {"number": 2500} or {"option": "employed"})
    value: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # When True, the stored state wins over auto evaluation.
    is_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    points: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0, server_default="0")

    checked_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    assessment: Mapped["EligibilityAssessment"] = relationship(
        "EligibilityAssessment", back_populates="items", lazy="noload"
    )
    criterion: Mapped["EligibilityCriterion"] = relationship(
        "EligibilityCriterion", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<EligibilityAssessmentItem criterion={self.criterion_id} met={self.is_met} points={self.points}>"
