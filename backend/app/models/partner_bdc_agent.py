"""BDC agents assigned to work a full-BDC partner store."""
import uuid

from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class PartnerBdcAgent(Base):
    __tablename__ = "partner_bdc_agents"
    __table_args__ = (
        UniqueConstraint("user_id", "partner_store_id", name="uq_partner_bdc_agent_store"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    partner_store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    max_open_leads: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
