"""Add leads.is_business from trust-score Business criterion

Revision ID: be_lead_is_business
Revises: bd_ai_assistant_stip_flags
Create Date: 2026-08-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "be_lead_is_business"
down_revision: Union[str, None] = "bd_ai_assistant_stip_flags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "leads",
        sa.Column("is_business", sa.Boolean(), nullable=True),
    )
    op.create_index("idx_leads_is_business", "leads", ["is_business"])


def downgrade() -> None:
    op.drop_index("idx_leads_is_business", table_name="leads")
    op.drop_column("leads", "is_business")
