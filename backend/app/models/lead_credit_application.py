"""
Lead Credit Application — in-CRM retail motor vehicle credit application (one per lead).
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.lead import Lead
    from app.models.dealership import Dealership
    from app.models.user import User


class CreditApplicationStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"


class CreditApplicationTransactionType(str, Enum):
    CREDIT_SALE = "credit_sale"
    LEASE = "lease"


class CreditApplicationType(str, Enum):
    INDIVIDUAL = "individual"
    JOINT = "joint"
    BUSINESS = "business"


class LeadCreditApplication(Base):
    """One credit application per lead."""

    __tablename__ = "lead_credit_applications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=CreditApplicationStatus.DRAFT.value,
        server_default=CreditApplicationStatus.DRAFT.value,
    )
    transaction_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    application_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    app_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    applicant_a: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    applicant_b: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    other_income: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    reference: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    bank_reference: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    authorization: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    dealer_section: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    applicant_a_ssn_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    applicant_b_ssn_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    lead: Mapped["Lead"] = relationship("Lead", lazy="noload")
    dealership: Mapped[Optional["Dealership"]] = relationship("Dealership", lazy="noload")

    def __repr__(self) -> str:
        return f"<LeadCreditApplication lead_id={self.lead_id} status={self.status}>"
