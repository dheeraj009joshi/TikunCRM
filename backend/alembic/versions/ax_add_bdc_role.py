"""Add BDC role, user_dealership_access, and leads.bdc_assigned_to_id

Revision ID: ax_add_bdc_role
Revises: aw_multi_dealership_email
Create Date: 2026-05-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "ax_add_bdc_role"
down_revision: Union[str, None] = "aw_multi_dealership_email"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'BDC'")

    op.create_table(
        "user_dealership_access",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dealership_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dealerships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assigned_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "dealership_id", name="uq_user_dealership_access"),
    )
    op.create_index(
        "ix_user_dealership_access_user_id",
        "user_dealership_access",
        ["user_id"],
    )
    op.create_index(
        "ix_user_dealership_access_dealership_id",
        "user_dealership_access",
        ["dealership_id"],
    )

    op.add_column(
        "leads",
        sa.Column(
            "bdc_assigned_to_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_leads_bdc_assigned_to_id",
        "leads",
        ["bdc_assigned_to_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_leads_bdc_assigned_to_id", table_name="leads")
    op.drop_column("leads", "bdc_assigned_to_id")
    op.drop_index("ix_user_dealership_access_dealership_id", table_name="user_dealership_access")
    op.drop_index("ix_user_dealership_access_user_id", table_name="user_dealership_access")
    op.drop_table("user_dealership_access")
