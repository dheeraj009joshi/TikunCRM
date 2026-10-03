"""Snapshot campaign names so edits do not rewrite past leads.

Revision ID: bt_campaign_mapping_versions
Revises: bs_merge_stips_category_dupes
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bt_campaign_mapping_versions"
down_revision: Union[str, None] = "bs_merge_stips_category_dupes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaign_mapping_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "campaign_mapping_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("campaign_mappings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("targeting_message", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_campaign_mapping_versions_campaign_mapping_id",
        "campaign_mapping_versions",
        ["campaign_mapping_id"],
    )

    op.add_column(
        "leads",
        sa.Column("campaign_version_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_leads_campaign_version_id",
        "leads",
        "campaign_mapping_versions",
        ["campaign_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_leads_campaign_version_id", "leads", ["campaign_version_id"])

    op.add_column(
        "lead_campaigns",
        sa.Column("campaign_version_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_lead_campaigns_campaign_version_id",
        "lead_campaigns",
        "campaign_mapping_versions",
        ["campaign_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_lead_campaigns_campaign_version_id",
        "lead_campaigns",
        ["campaign_version_id"],
    )

    # Freeze today's name and message onto every existing lead.
    op.execute(
        """
        INSERT INTO campaign_mapping_versions (
            id, campaign_mapping_id, display_name, targeting_message, created_by, created_at
        )
        SELECT
            gen_random_uuid(),
            id,
            display_name,
            NULLIF(BTRIM(targeting_message), ''),
            updated_by,
            COALESCE(updated_at, created_at, now())
        FROM campaign_mappings
        """
    )
    op.execute(
        """
        UPDATE leads AS l
        SET campaign_version_id = v.id
        FROM campaign_mapping_versions AS v
        WHERE l.campaign_mapping_id = v.campaign_mapping_id
          AND l.campaign_version_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE lead_campaigns AS lc
        SET campaign_version_id = v.id
        FROM campaign_mapping_versions AS v
        WHERE lc.campaign_mapping_id = v.campaign_mapping_id
          AND lc.campaign_version_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_lead_campaigns_campaign_version_id", table_name="lead_campaigns")
    op.drop_constraint("fk_lead_campaigns_campaign_version_id", "lead_campaigns", type_="foreignkey")
    op.drop_column("lead_campaigns", "campaign_version_id")
    op.drop_index("ix_leads_campaign_version_id", table_name="leads")
    op.drop_constraint("fk_leads_campaign_version_id", "leads", type_="foreignkey")
    op.drop_column("leads", "campaign_version_id")
    op.drop_index(
        "ix_campaign_mapping_versions_campaign_mapping_id",
        table_name="campaign_mapping_versions",
    )
    op.drop_table("campaign_mapping_versions")
