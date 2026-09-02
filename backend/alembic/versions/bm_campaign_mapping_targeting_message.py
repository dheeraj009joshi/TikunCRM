"""Add targeting_message to campaign_mappings

Revision ID: bm_campaign_targeting
Revises: bk_align_carvaminos
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "bm_campaign_targeting"
down_revision: Union[str, None] = "bk_align_carvaminos"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "campaign_mappings",
        sa.Column(
            "targeting_message",
            sa.Text(),
            nullable=True,
            comment="Targeting or audience description shown on hover in campaign mappings UI",
        ),
    )


def downgrade() -> None:
    op.drop_column("campaign_mappings", "targeting_message")
