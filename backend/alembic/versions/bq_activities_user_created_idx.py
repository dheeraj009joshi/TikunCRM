"""Index activities by user + created_at for timesheet shift lookups

Revision ID: bq_activities_user_created_idx
Revises: bp_bdc_hour_caps
Create Date: 2026-09-14
"""
from typing import Sequence, Union

from alembic import op

revision: str = "bq_activities_user_created_idx"
down_revision: Union[str, None] = "bp_bdc_hour_caps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_activities_user_id_created_at",
        "activities",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_activities_user_id_created_at", table_name="activities")
