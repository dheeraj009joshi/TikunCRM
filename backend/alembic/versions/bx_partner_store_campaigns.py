"""Link partner stores to the campaigns whose leads they receive.

Revision ID: bx_partner_store_campaigns
Revises: bw_partner_programs
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bx_partner_store_campaigns"
down_revision: Union[str, None] = "bw_partner_programs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "partner_store_campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("partner_store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("campaign_mapping_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["partner_store_id"], ["partner_stores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["campaign_mapping_id"], ["campaign_mappings.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "partner_store_id",
            "campaign_mapping_id",
            name="uq_partner_store_campaign",
        ),
    )
    op.create_index(
        "ix_partner_store_campaigns_store",
        "partner_store_campaigns",
        ["partner_store_id"],
    )
    op.create_index(
        "ix_partner_store_campaigns_campaign",
        "partner_store_campaigns",
        ["campaign_mapping_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_partner_store_campaigns_campaign", table_name="partner_store_campaigns")
    op.drop_index("ix_partner_store_campaigns_store", table_name="partner_store_campaigns")
    op.drop_table("partner_store_campaigns")
