"""Campaigns whose leads are delivered to a partner store.

One store can be linked to many campaigns. A campaign can also be linked to
more than one store; routing then picks a store using the usual caps.
"""
import uuid

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class PartnerStoreCampaign(Base):
    __tablename__ = "partner_store_campaigns"
    __table_args__ = (
        UniqueConstraint(
            "partner_store_id",
            "campaign_mapping_id",
            name="uq_partner_store_campaign",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    partner_store_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    campaign_mapping_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("campaign_mappings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
