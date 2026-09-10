"""BDC agent time tracking: hourly rate + clock punches

Revision ID: bo_bdc_time_tracking
Revises: bn_appointment_partner
Create Date: 2026-09-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "bo_bdc_time_tracking"
down_revision: Union[str, None] = "bn_appointment_partner"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=True),
    )

    op.create_table(
        "time_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("clock_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clock_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "overtime_multiplier",
            sa.Numeric(4, 2),
            nullable=False,
            server_default="1.50",
        ),
        sa.Column("clock_in_note", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="web"),
        sa.Column("edited_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edit_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["edited_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_time_entries_user_id", "time_entries", ["user_id"])
    op.create_index("ix_time_entries_user_clock_in", "time_entries", ["user_id", "clock_in_at"])
    op.create_index(
        "uq_time_entries_one_open_per_user",
        "time_entries",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("clock_out_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_time_entries_one_open_per_user", table_name="time_entries")
    op.drop_index("ix_time_entries_user_clock_in", table_name="time_entries")
    op.drop_index("ix_time_entries_user_id", table_name="time_entries")
    op.drop_table("time_entries")
    op.drop_column("users", "hourly_rate")
