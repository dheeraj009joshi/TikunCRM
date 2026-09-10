"""BDC per-agent hour caps and over-cap pay approval

Revision ID: bp_bdc_hour_caps
Revises: bo_bdc_time_tracking
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "bp_bdc_hour_caps"
down_revision: Union[str, None] = "bo_bdc_time_tracking"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("max_hours_week", sa.Numeric(5, 2), nullable=True))
    op.add_column("users", sa.Column("max_hours_monday", sa.Numeric(4, 2), nullable=True))
    op.add_column("users", sa.Column("max_hours_tuesday", sa.Numeric(4, 2), nullable=True))
    op.add_column("users", sa.Column("max_hours_wednesday", sa.Numeric(4, 2), nullable=True))
    op.add_column("users", sa.Column("max_hours_thursday", sa.Numeric(4, 2), nullable=True))
    op.add_column("users", sa.Column("max_hours_friday", sa.Numeric(4, 2), nullable=True))
    op.add_column("users", sa.Column("max_hours_saturday", sa.Numeric(4, 2), nullable=True))
    op.add_column("users", sa.Column("max_hours_sunday", sa.Numeric(4, 2), nullable=True))

    op.add_column(
        "time_entries",
        sa.Column(
            "over_cap_approved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "time_entries",
        sa.Column("over_cap_approved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "time_entries",
        sa.Column("over_cap_approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_time_entries_over_cap_approved_by",
        "time_entries",
        "users",
        ["over_cap_approved_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_time_entries_over_cap_approved_by", "time_entries", type_="foreignkey")
    op.drop_column("time_entries", "over_cap_approved_at")
    op.drop_column("time_entries", "over_cap_approved_by_id")
    op.drop_column("time_entries", "over_cap_approved")
    op.drop_column("users", "max_hours_sunday")
    op.drop_column("users", "max_hours_saturday")
    op.drop_column("users", "max_hours_friday")
    op.drop_column("users", "max_hours_thursday")
    op.drop_column("users", "max_hours_wednesday")
    op.drop_column("users", "max_hours_tuesday")
    op.drop_column("users", "max_hours_monday")
    op.drop_column("users", "max_hours_week")
